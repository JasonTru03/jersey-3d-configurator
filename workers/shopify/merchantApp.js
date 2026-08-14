import { createAdminGraphqlClient } from './adminGraphql.js';
import {
  createCsrfToken,
  readAppSessionCookie,
  verifyAppSession,
  verifyCsrfToken,
} from './appSession.js';
import { createOAuthRepository } from './oauthRepository.js';
import { activateStore, listProducts, verifySelectedVariants } from './storeActivation.js';
import { normalizeShop, normalizeStoreConfig } from './storeConfig.js';
import {
  createStoreConfigRepository,
  StoreConfigRepositoryError,
} from './storeConfigRepository.js';
import { createTokenVault } from './tokenVault.js';

const MAX_BODY_BYTES = 64 * 1024;
const FIXED_PRODUCT_ID = 'fn8788-jersey';
const SIGNING_SECRET_PURPOSE = 'shopify-function-signing-secret';
const ACTIVATION_LOCK_TTL_MS = 15 * 60 * 1000;
const APP_VERSION = '1.0.0';

export function createMerchantAppHandler(env, dependencies = {}) {
  const createOAuthRepo = dependencies.createOAuthRepository ?? createOAuthRepository;
  const createConfigRepo = dependencies.createStoreConfigRepository ?? createStoreConfigRepository;
  const createVault = dependencies.createTokenVault ?? createTokenVault;
  const createGraphql = dependencies.createAdminGraphqlClient ?? createAdminGraphqlClient;
  const activate = dependencies.activateStore ?? activateStore;
  const fetchProducts = dependencies.listProducts ?? listProducts;
  const verifyVariants = dependencies.verifySelectedVariants ?? verifySelectedVariants;
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? secureRandomBytes;
  const logger = dependencies.logger ?? console;

  return async function handleMerchantApp(request) {
    try {
      const bindings = validateBindings(env, { createConfigRepo, createOAuthRepo, createVault });
      const url = new URL(request.url);
      const shop = readShop(url.searchParams.get('shop'));
      const currentTime = readNow(now);
      const session = readAppSessionCookie(request.headers.get('Cookie'));
      if (!await verifyAppSession(session, shop, currentTime, bindings.secret)) {
        return errorResponse(401, '登录会话已失效，请从 Shopify 后台重新打开应用。');
      }
      const installation = await bindings.oauthRepository.getInstallation(shop);
      if (!installation || installation.status !== 'active') {
        return errorResponse(403, '应用授权不完整，请重新安装应用。');
      }
      const accessToken = await bindings.tokenVault.decrypt(shop, installation);
      const graphql = createGraphql({ shop, accessToken });

      if (request.method === 'GET') {
        const [products, stored] = await Promise.all([
          fetchProducts(graphql),
          bindings.configRepository.get(shop),
        ]);
        return renderPage({
          csrfToken: await createCsrfToken(session, bindings.secret),
          nonce: encodeBase64Url(readRandomBytes(randomBytes, 18)),
          products,
          apiKey: bindings.apiKey,
          shop,
          stored,
        });
      }
      if (request.method === 'POST') {
        return saveConfiguration({
          activate,
          bindings,
          currentTime,
          graphql,
          randomBytes,
          request,
          session,
          shop,
          verifyVariants,
        });
      }
      return errorResponse(405, '请求方法不受支持。', { Allow: 'GET, POST' });
    } catch {
      logger.error?.('SHOPIFY_MERCHANT_APP_FAILED');
      return errorResponse(503, '店铺配置暂时不可用，请稍后重试。');
    }
  };
}

async function saveConfiguration({
  activate,
  bindings,
  currentTime,
  graphql,
  randomBytes,
  request,
  session,
  shop,
  verifyVariants,
}) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('Content-Type') ?? '')) {
    return errorResponse(415, '配置请求必须使用 JSON。');
  }
  if (!await verifyCsrfToken(request.headers.get('X-CSRF-Token'), session, bindings.secret)) {
    return errorResponse(403, '安全校验失败，请刷新页面后重试。');
  }
  let body;
  try {
    body = await readJson(request);
  } catch {
    return errorResponse(400, '配置请求内容无效。');
  }
  let shopifyProductGid;
  let jerseyVariants;
  let surchargeVariants;
  try {
    shopifyProductGid = requireGid(body.shopifyProductGid, 'Product');
    jerseyVariants = normalizeVariantMap(body.jerseyVariants, ['s', 'm', 'l', 'xl']);
    surchargeVariants = normalizeSurcharges(body.surchargeVariants);
  } catch {
    return errorResponse(400, '商品或变体配置无效。');
  }

  let verified;
  try {
    verified = await verifyVariants({
      graphql,
      productGid: shopifyProductGid,
      jerseyVariantGids: Object.values(jerseyVariants).map(variantGid),
      surchargeVariantGids: Object.values(surchargeVariants).map(variantGid),
    });
  } catch {
    return errorResponse(400, '所选商品或变体不属于当前店铺，或尺码变体不属于球衣商品。');
  }
  if (verified.currency !== 'USD') {
    return errorResponse(400, '当前版本仅支持店铺基础币种为 USD。');
  }
  const config = normalizeStoreConfig({
    productId: FIXED_PRODUCT_ID,
    currency: verified.currency,
    jerseyVariants,
    surchargeVariants,
  });
  const signingSecret = encodeBase64Url(readRandomBytes(randomBytes, 32));
  const activationLockToken = encodeBase64Url(readRandomBytes(randomBytes, 24));
  const encryptedSigningSecret = await bindings.configSecretVault.encrypt(shop, signingSecret);
  let revision;
  try {
    revision = await bindings.configRepository.saveDraft({
      shop,
      shopifyProductGid,
      config,
      encryptedSigningSecret,
      activationLockToken,
      activationLockExpiresAt: currentTime + ACTIVATION_LOCK_TTL_MS,
      updatedAt: currentTime,
    });
  } catch (error) {
    if (error instanceof StoreConfigRepositoryError && error.code === 'store-config-conflict') {
      return errorResponse(409, '该店铺正在启用另一份配置，请稍后重试。');
    }
    throw error;
  }
  try {
    const registrations = await activate({ graphql, shop, config, signingSecret });
    await bindings.configRepository.markActive({
      shop,
      revision,
      activationLockToken,
      ...registrations,
      updatedAt: currentTime,
    });
    return Response.json({ ok: true, status: 'active', revision }, noStoreJson());
  } catch {
    await bindings.configRepository.markActivationFailed({
      shop,
      revision,
      activationLockToken,
      errorCode: 'FUNCTION_ACTIVATION_FAILED',
      updatedAt: currentTime,
    });
    return errorResponse(502, '商品配置已保存，但结账功能启用失败，请重试。');
  }
}

function validateBindings(env, factories) {
  if (!env || typeof env.SHOPIFY_API_SECRET !== 'string'
    || new TextEncoder().encode(env.SHOPIFY_API_SECRET).length < 16
    || !env.PRODUCTION_DB) throw new Error('Invalid merchant bindings.');
  const oauthRepository = factories.createOAuthRepo(env.PRODUCTION_DB);
  const configRepository = factories.createConfigRepo(env.PRODUCTION_DB, {
    legacyConfigJson: env.SHOPIFY_STORE_CONFIG_JSON ?? '{}',
  });
  return {
    apiKey: requireApiKey(env.SHOPIFY_API_KEY),
    configRepository,
    configSecretVault: factories.createVault(env.SHOPIFY_TOKEN_ENCRYPTION_KEY, {
      purpose: SIGNING_SECRET_PURPOSE,
    }),
    oauthRepository,
    secret: env.SHOPIFY_API_SECRET,
    tokenVault: factories.createVault(env.SHOPIFY_TOKEN_ENCRYPTION_KEY),
  };
}

function renderPage({ apiKey, csrfToken, nonce, products, shop, stored }) {
  const safeProducts = safeJson(products.map((product) => ({
    id: product.id,
    title: product.title,
    variantsTruncated: product.variantsTruncated === true,
    variants: product.variants.nodes.map((variant) => ({
      id: variant.id,
      title: variant.title,
      price: variant.price,
    })),
  })));
  const selected = stored?.source === 'database' ? stored : null;
  const current = selected ? {
    jersey: selected.config.jerseyVariants,
    product: selected.shopifyProductGid,
    revision: selected.revision,
    surcharges: selected.config.surchargeVariants,
  } : null;
  const active = stored?.status === 'active';
  const safeShop = escapeHtml(shop);
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>3D 球衣定制管理</title><style>${styles()}</style></head>
<body><main class="app-shell"><header class="hero"><div class="brand-line"><span class="brand-mark" aria-hidden="true">SJ</span><p class="eyebrow">SECURE JERSEY · MERCHANT CONSOLE</p><span class="version">v${APP_VERSION}</span></div>
<div class="connection"><span aria-hidden="true"></span>店铺已连接</div><h1>3D 球衣定制管理</h1><p class="hero-copy">集中管理商品映射、结账功能和定制生产订单。</p>
<div class="hero-actions"><a class="button primary" href="#product-config">管理商品配置</a><a class="button secondary" href="/admin/" target="_blank" rel="noreferrer">查看定制订单</a><a class="text-link" href="https://${safeShop}" target="_blank" rel="noreferrer">打开在线商店 <span aria-hidden="true">↗</span></a></div></header>
<section class="status-grid" aria-label="应用状态"><article class="status-card"><div class="status-icon connected" aria-hidden="true">✓</div><div><p>店铺连接</p><strong>已安全授权</strong><span>${safeShop}</span></div></article>
<article class="status-card"><div class="status-icon ${active ? 'connected' : 'pending'}" aria-hidden="true">${active ? '✓' : '·'}</div><div><p>结账功能</p><strong id="config-status-label">${active ? '已启用' : '等待配置'}</strong><span>${active ? '商品与附加价映射生效中' : '完成下方商品配置后启用'}</span></div></article>
<article class="status-card"><div class="status-icon ${active ? 'connected' : 'pending'}" aria-hidden="true">${active ? '✓' : '·'}</div><div><p>生产流程</p><strong id="workflow-status-label">${active ? '订单绑定就绪' : '等待商品配置'}</strong><span>安全交接并保存生产文件</span></div></article></section>
<section class="workspace card" id="product-config"><div class="section-heading"><div><p class="section-kicker">PRODUCT SETUP</p><h2>球衣商品配置</h2><p>选择球衣尺码变体及附加价商品，保存后立即应用到结账流程。</p></div><div class="status ${active ? 'active' : ''}" id="configuration-badge">${active ? '当前配置已启用' : '需要完成配置'}</div></div>
<form id="config-form"><label>球衣商品<select id="product" required><option value="">请选择商品</option></select></label><p class="help hidden" id="catalog-note">该商品变体超过 100 个，此处仅显示前 100 个。</p>
<div class="grid">${['s', 'm', 'l', 'xl'].map((size) => `<label>${size.toUpperCase()} 尺码变体<select id="size-${size}" required><option value="">请先选择球衣商品</option></select></label>`).join('')}</div>
<fieldset><legend>附加价变体</legend><p class="help">每一行对应一个附加金额和店铺中的附加价商品变体。</p><div id="surcharge-rows"></div><button class="secondary" id="add-surcharge" type="button">添加附加价</button></fieldset>
<button class="primary" type="submit">保存并启用结账功能</button><p id="message" role="status" aria-live="polite"></p></form>
<aside class="theme-step ${active ? '' : 'hidden'}" id="theme-step"><div><p class="section-kicker">STOREFRONT</p><h3>店面 3D 定制入口</h3><p>在产品模板中预览并添加“3D jersey configurator”应用块，然后保存主题。</p></div><a class="button secondary theme-link" href="${escapeHtml(themeEditorUrl(shop, apiKey))}" target="_top" rel="noreferrer">打开 Shopify 主题编辑器</a></aside></section>
<footer><span>Secure Jersey Configurator</span><span>Version ${APP_VERSION}</span></footer></main>
<script nonce="${nonce}">const products=${safeProducts};const csrf=${safeJson(csrfToken)};const current=${safeJson(current)};${clientScript()}</script></body></html>`;
  return new Response(html, { headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  } });
}

function clientScript() {
  return `const product=document.querySelector('#product');const sizes=['s','m','l','xl'];const rows=document.querySelector('#surcharge-rows');
function numericId(gid){return gid.split('/').pop()}function variantOptions(selected=''){const root=document.createDocumentFragment();root.append(new Option('请选择变体',''));for(const item of products){const group=document.createElement('optgroup');group.label=item.title;for(const variant of item.variants){const option=new Option(variant.title+' · '+variant.price,numericId(variant.id));option.selected=option.value===String(selected);group.append(option)}root.append(group)}return root}
for(const item of products)product.add(new Option(item.title,item.id));
function fillSizes(){const item=products.find(entry=>entry.id===product.value);document.querySelector('#catalog-note').classList.toggle('hidden',!item?.variantsTruncated);for(const size of sizes){const select=document.querySelector('#size-'+size);const previous=select.value;select.replaceChildren(new Option(item?'请选择变体':'请先选择球衣商品',''));for(const variant of item?.variants||[])select.add(new Option(variant.title+' · '+variant.price,numericId(variant.id)));if([...select.options].some(option=>option.value===previous))select.value=previous}}
function addSurcharge(amount='',variant=''){const row=document.createElement('div');row.className='surcharge-row';const amountInput=document.createElement('input');amountInput.type='number';amountInput.min='1';amountInput.max='10000';amountInput.step='1';amountInput.placeholder='金额';amountInput.value=amount;amountInput.required=true;amountInput.setAttribute('aria-label','附加金额');const select=document.createElement('select');select.required=true;select.setAttribute('aria-label','附加价变体');select.append(variantOptions(variant));const remove=document.createElement('button');remove.type='button';remove.className='remove';remove.textContent='删除';remove.addEventListener('click',()=>row.remove());row.append(amountInput,select,remove);rows.append(row)}
product.addEventListener('change',fillSizes);document.querySelector('#add-surcharge').addEventListener('click',()=>addSurcharge());
if(current){product.value=current.product;fillSizes();for(const size of sizes)document.querySelector('#size-'+size).value=current.jersey[size];for(const [amount,variant] of Object.entries(current.surcharges))addSurcharge(amount,variant)}else addSurcharge();
document.querySelector('#config-form').addEventListener('submit',async event=>{event.preventDefault();const message=document.querySelector('#message');message.className='';message.textContent='正在验证并启用…';const surchargeVariants={};for(const row of rows.children){const [amount,variant]=row.querySelectorAll('input,select');if(surchargeVariants[amount.value]){message.className='error';message.textContent='附加金额不能重复。';return}surchargeVariants[amount.value]=variant.value}const jerseyVariants=Object.fromEntries(sizes.map(size=>[size,document.querySelector('#size-'+size).value]));try{const response=await fetch(location.href,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({shopifyProductGid:product.value,jerseyVariants,surchargeVariants})});const result=await response.json();if(!response.ok)throw new Error(result.error);message.className='success';message.textContent='配置成功，结账功能已启用。';document.querySelector('#theme-step').classList.remove('hidden');const badge=document.querySelector('#configuration-badge');badge.className='status active';badge.textContent='当前配置已启用';document.querySelector('#config-status-label').textContent='已启用';document.querySelector('#workflow-status-label').textContent='订单绑定就绪'}catch(error){message.className='error';message.textContent=error.message||'保存失败，请重试。'}});`;
}

function styles() {
  return `:root{color:#17261d;background:#f4f5f1;font-family:Inter,"Noto Sans SC",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;min-height:100vh;background:radial-gradient(circle at 8% 0%,rgba(29,98,71,.11),transparent 34rem),#f4f5f1;color:#17261d}.app-shell{width:min(1120px,calc(100% - 32px));margin:auto;padding:38px 0 54px}.hero{position:relative;overflow:hidden;border:1px solid #dfe4dd;border-radius:24px;padding:34px;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(246,248,244,.94));box-shadow:0 18px 60px rgba(29,52,40,.08)}.hero:after{position:absolute;right:-86px;bottom:-128px;width:340px;height:340px;border:54px solid rgba(29,98,71,.055);border-radius:50%;content:""}.brand-line{position:relative;z-index:1;display:flex;align-items:center;gap:12px}.brand-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;color:#fff;background:#1d6247;font-size:12px;font-weight:900;letter-spacing:.04em}.eyebrow,.section-kicker{margin:0;color:#1d6247;font-size:11px;font-weight:850;letter-spacing:.16em}.version{margin-left:auto;border:1px solid #d8dfd9;border-radius:999px;padding:6px 10px;color:#536159;background:#fff;font-size:12px;font-weight:800}.connection{position:relative;z-index:1;display:inline-flex;align-items:center;gap:8px;margin-top:34px;border-radius:999px;padding:8px 12px;color:#176044;background:#e6f4ec;font-size:13px;font-weight:800}.connection span{width:8px;height:8px;border-radius:50%;background:#1e865f;box-shadow:0 0 0 4px rgba(30,134,95,.12)}h1{position:relative;z-index:1;margin:16px 0 0;max-width:720px;font-size:clamp(34px,6vw,58px);line-height:1.04;letter-spacing:-.04em}.hero-copy{position:relative;z-index:1;max-width:620px;margin:16px 0 0;color:#5f6b63;font-size:17px;line-height:1.65}.hero-actions{position:relative;z-index:1;display:flex;align-items:center;flex-wrap:wrap;gap:11px;margin-top:28px}.button,button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:11px;padding:0 18px;font:inherit;font-weight:800;text-decoration:none;cursor:pointer}.primary{color:#fff;background:#1d6247;box-shadow:0 8px 20px rgba(29,98,71,.16)}.primary:hover{background:#17533c}.secondary{border:1px solid #cbd3ca;color:#25352c;background:#fff}.secondary:hover{border-color:#aebbb1;background:#fafbf9}.text-link{padding:10px 4px;color:#1d6247;font-weight:800;text-decoration:none}.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:16px 0}.status-card{display:flex;min-width:0;gap:13px;border:1px solid #dfe4dd;border-radius:17px;padding:20px;background:rgba(255,255,255,.9)}.status-icon{display:grid;flex:0 0 32px;height:32px;place-items:center;border-radius:10px;font-weight:900}.status-icon.connected{color:#176044;background:#e6f4ec}.status-icon.pending{color:#7a6547;background:#f4efe5}.status-card p{margin:0 0 5px;color:#7a857d;font-size:12px;font-weight:750}.status-card strong,.status-card span{display:block;overflow:hidden;text-overflow:ellipsis}.status-card strong{font-size:16px}.status-card span{margin-top:5px;color:#6b776f;font-size:12px;white-space:nowrap}.card{border:1px solid #dfe4dd;border-radius:20px;padding:30px;background:#fff;box-shadow:0 10px 38px rgba(29,52,40,.05)}.workspace{scroll-margin-top:20px}.section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:24px;border-bottom:1px solid #e8ece7}.section-heading h2{margin:7px 0 5px;font-size:28px;letter-spacing:-.025em}.section-heading p:not(.section-kicker){margin:0;color:#667268}.status{display:inline-flex;flex:0 0 auto;border-radius:999px;padding:8px 12px;color:#6f5c41;background:#f4efe5;font-size:13px;font-weight:800}.status.active{color:#176044;background:#e6f4ec}form{margin-top:26px}label{display:grid;gap:8px;margin-bottom:18px;color:#34433a;font-weight:750}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}select,input{width:100%;min-width:0;min-height:46px;border:1px solid #bcc6bf;border-radius:11px;padding:0 13px;background:#fff;color:inherit;font:inherit;outline:none}select:focus,input:focus{border-color:#1d6247;box-shadow:0 0 0 3px rgba(29,98,71,.12)}fieldset{border:1px solid #d9ded9;border-radius:14px;margin:6px 0 24px;padding:19px}legend{padding:0 7px;font-weight:850}.help{margin:0 0 14px;color:#667268;font-size:14px}.surcharge-row{display:grid;grid-template-columns:120px 1fr auto;gap:10px;margin-bottom:10px}.remove{min-height:44px;border:0;border-radius:10px;padding:0 16px;color:#8c2d1d;background:#f7e8e5;font-weight:800;cursor:pointer}#message{min-height:22px;margin:13px 0 0}.theme-step{display:flex;align-items:center;justify-content:space-between;gap:24px;border-top:1px solid #e3e8e2;margin-top:30px;padding-top:26px}.theme-step h3{margin:6px 0;font-size:21px}.theme-step p:not(.section-kicker){margin:0;color:#667268}.theme-link{flex:0 0 auto}.hidden{display:none}.success{color:#08795b;font-weight:750}.error{color:#a12819;font-weight:750}footer{display:flex;justify-content:space-between;padding:22px 4px 0;color:#7a857d;font-size:12px}@media(max-width:780px){.status-grid{grid-template-columns:1fr}.status-card span{white-space:normal}.section-heading,.theme-step{align-items:stretch;flex-direction:column}.theme-link{align-self:flex-start}}@media(max-width:640px){.app-shell{width:min(100% - 24px,1120px);padding:18px 0 36px}.hero,.card{border-radius:18px;padding:22px}.hero:after{right:-180px}.brand-line{gap:9px}.eyebrow{font-size:10px;letter-spacing:.1em}.version{padding:5px 8px}h1{font-size:36px}.hero-copy{font-size:15px}.hero-actions{align-items:stretch;flex-direction:column}.hero-actions .button,.hero-actions .text-link{width:100%;justify-content:center}.grid{grid-template-columns:1fr}.surcharge-row{grid-template-columns:1fr}.surcharge-row .remove{justify-self:start}.section-heading h2{font-size:24px}footer{gap:8px;flex-direction:column}}`;
}

async function readJson(request) {
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > MAX_BODY_BYTES) throw new Error('Body too large.');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new Error('Body too large.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON.');
  return value;
}

function normalizeVariantMap(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length) throw new TypeError();
  return Object.fromEntries(keys.map((key) => [key, requireNumericId(value[key])]));
}

function normalizeSurcharges(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
  return Object.fromEntries(Object.entries(value).map(([amount, id]) => {
    if (!/^[1-9][0-9]{0,4}$/u.test(amount) || Number(amount) > 10000) throw new TypeError();
    return [amount, requireNumericId(id)];
  }));
}

function requireNumericId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,31}$/u.test(value)) throw new TypeError();
  return value;
}

function requireGid(value, type) {
  if (typeof value !== 'string'
    || !new RegExp(`^gid://shopify/${type}/[1-9][0-9]{0,31}$`, 'u').test(value)) throw new TypeError();
  return value;
}

function variantGid(value) {
  return `gid://shopify/ProductVariant/${value}`;
}

function readShop(value) {
  try { return normalizeShop(value); } catch { throw new Error('Invalid shop.'); }
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid clock.');
  return value;
}

function readRandomBytes(randomBytes, length) {
  const value = randomBytes(length);
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error('Invalid randomness.');
  return value;
}

function secureRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</gu, '\\u003c');
}

function requireApiKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
    throw new Error('Invalid Shopify API key.');
  }
  return value;
}

function themeEditorUrl(shop, apiKey) {
  const url = new URL(`https://${shop}/admin/themes/current/editor`);
  url.searchParams.set('template', 'product');
  url.searchParams.set('addAppBlockId', `${apiKey}/secure-jersey-launcher`);
  url.searchParams.set('target', 'newAppsSection');
  return url.toString();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function noStoreJson() {
  return { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } };
}

function errorResponse(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), { status, headers: {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', ...extra,
  } });
}
