const views = {
  login: document.querySelector('#login-view'),
  dashboard: document.querySelector('#dashboard-view'),
};
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const ordersError = document.querySelector('#orders-error');
const ordersBody = document.querySelector('#orders-body');
const emptyState = document.querySelector('#empty-state');
const resultSummary = document.querySelector('#result-summary');
const pageLabel = document.querySelector('#page-label');
const previousPage = document.querySelector('#previous-page');
const nextPage = document.querySelector('#next-page');
const shopSelect = document.querySelector('#shop');
let currentPage = 1;
let lastPage = 1;
let orderRequestSequence = 0;

const statusLabels = Object.freeze({
  paid_pending_production: '待生产',
  file_error: '文件异常',
  cancelled: '已取消',
  refunded: '已退款',
  archived: '已归档',
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/admin/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: document.querySelector('#password').value }),
    });
    if (!response.ok) throw new Error(await readError(response));
    loginForm.reset();
    await loadSession();
  } catch (error) {
    loginError.textContent = error.message || '登录失败，请重试。';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  await fetch('/admin/api/logout', { method: 'POST', credentials: 'same-origin' });
  showView('login');
});

document.querySelector('#filters').addEventListener('submit', (event) => {
  event.preventDefault();
  currentPage = 1;
  void loadOrders();
});

document.querySelector('#refresh-button').addEventListener('click', () => {
  void loadOrders();
});

shopSelect.addEventListener('change', () => {
  currentPage = 1;
  document.querySelector('#shop-name').textContent = shopSelect.value;
  void loadOrders();
});

previousPage.addEventListener('click', () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  void loadOrders();
});

nextPage.addEventListener('click', () => {
  if (currentPage >= lastPage) return;
  currentPage += 1;
  void loadOrders();
});

void loadSession();

async function loadSession() {
  try {
    const response = await fetch('/admin/api/session', { credentials: 'same-origin' });
    if (response.status === 401) {
      showView('login');
      return;
    }
    if (!response.ok) throw new Error(await readError(response));
    const session = await response.json();
    populateShops(session);
    showView('dashboard');
    currentPage = 1;
    await loadOrders();
  } catch {
    showView('login');
    loginError.textContent = '后台暂时无法连接，请稍后刷新。';
  }
}

async function loadOrders() {
  const requestSequence = ++orderRequestSequence;
  const selectedShop = shopSelect.value;
  ordersError.textContent = '';
  resultSummary.textContent = '正在读取订单…';
  previousPage.disabled = true;
  nextPage.disabled = true;
  try {
    const response = await fetch(`/admin/api/orders?${buildQuery(selectedShop)}`, {
      credentials: 'same-origin',
    });
    if (response.status === 401) {
      showView('login');
      loginError.textContent = '登录已过期，请重新登录。';
      return;
    }
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json();
    if (requestSequence !== orderRequestSequence || selectedShop !== shopSelect.value) return;
    renderOrders(result.items, selectedShop);
    lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
    currentPage = Math.min(result.page, lastPage);
    resultSummary.textContent = `共 ${result.total} 个定制订单`;
    pageLabel.textContent = `第 ${currentPage} / ${lastPage} 页`;
    previousPage.disabled = currentPage <= 1;
    nextPage.disabled = currentPage >= lastPage;
  } catch (error) {
    if (requestSequence !== orderRequestSequence || selectedShop !== shopSelect.value) return;
    ordersError.textContent = error.message || '订单读取失败，请重试。';
    resultSummary.textContent = '订单读取失败';
  }
}

function buildQuery(shop) {
  const params = new URLSearchParams();
  const query = document.querySelector('#query').value.trim();
  const status = document.querySelector('#status').value;
  const from = localDateStart(document.querySelector('#date-from').value);
  const toStart = localDateStart(document.querySelector('#date-to').value);
  params.set('shop', shop);
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (from !== null) params.set('from', String(from));
  if (toStart !== null) params.set('to', String(toStart + 24 * 60 * 60 * 1000 - 1));
  params.set('page', String(currentPage));
  return params.toString();
}

function renderOrders(items, shop) {
  ordersBody.replaceChildren();
  emptyState.hidden = items.length !== 0;
  for (const item of items) {
    const row = document.createElement('tr');
    row.append(
      cellWithPrimary(item.orderName, item.orderGid),
      statusCell(item.status),
      cellWithPrimary(`${item.productId} / ${item.size.toUpperCase()}`, `${item.modelId} v${item.modelVersion}`),
      cellWithPrimary(item.designFingerprint, item.designId),
      cellWithPrimary(formatDate(item.paidAt), item.bundleFilename),
      downloadCell(item, shop),
    );
    ordersBody.append(row);
  }
}

function cellWithPrimary(primary, secondary) {
  const cell = document.createElement('td');
  const main = document.createElement('span');
  main.className = 'order-name';
  main.textContent = primary || '—';
  const detail = document.createElement('span');
  detail.className = 'cell-secondary';
  detail.textContent = secondary || '—';
  cell.append(main, detail);
  return cell;
}

function statusCell(status) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge${status === 'file_error' ? ' bad' : ['cancelled', 'refunded', 'archived'].includes(status) ? ' neutral' : ''}`;
  badge.textContent = statusLabels[status] || status;
  cell.append(badge);
  return cell;
}

function downloadCell(item, shop) {
  const cell = document.createElement('td');
  if (!item.bundleIndexed || item.status === 'file_error') {
    const warning = document.createElement('span');
    warning.className = 'file-missing';
    warning.textContent = item.status === 'file_error' ? '文件异常' : '文件缺失';
    cell.append(warning);
    return cell;
  }
  const link = document.createElement('a');
  link.className = 'download-link';
  link.href = `/admin/api/orders/${encodeURIComponent(item.designId)}/download?shop=${encodeURIComponent(shop)}`;
  link.textContent = '下载 ZIP';
  cell.append(link);
  return cell;
}

function populateShops(session) {
  if (!session
    || typeof session.shop !== 'string'
    || !Array.isArray(session.shops)
    || session.shops.length === 0
    || !session.shops.includes(session.shop)
    || session.shops.some((shop) => typeof shop !== 'string')) {
    throw new Error('后台店铺配置无效。');
  }
  shopSelect.replaceChildren();
  for (const shop of session.shops) {
    const option = document.createElement('option');
    option.value = shop;
    option.textContent = shop;
    shopSelect.append(option);
  }
  shopSelect.value = session.shop;
  document.querySelector('#shop-name').textContent = session.shop;
}

function localDateStart(value) {
  if (!value) return null;
  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDate(value) {
  if (!Number.isSafeInteger(value)) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function readError(response) {
  try {
    const body = await response.json();
    return body.error || '请求失败。';
  } catch {
    return '请求失败。';
  }
}

function showView(name) {
  views.login.hidden = name !== 'login';
  views.dashboard.hidden = name !== 'dashboard';
}
