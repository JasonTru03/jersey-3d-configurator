import {readFile, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "package.json",
  "package-lock.json",
  "shopify.app.toml",
  "LICENSE.shopify-function-examples.md",
  "NOTICE.md",
  "extensions/secure-jersey-transform/Cargo.toml",
  "extensions/secure-jersey-transform/shopify.extension.toml",
  "extensions/secure-jersey-transform/schema.graphql",
  "extensions/secure-jersey-transform/src/run.graphql",
  "extensions/secure-jersey-transform/src/run.rs",
  "extensions/secure-jersey-validation/Cargo.toml",
  "extensions/secure-jersey-validation/shopify.extension.toml",
  "extensions/secure-jersey-validation/schema.graphql",
  "extensions/secure-jersey-validation/src/run.graphql",
  "extensions/secure-jersey-validation/src/run.rs",
];

const contents = new Map();
for (const file of requiredFiles) {
  contents.set(file, await readFile(resolve(root, file), "utf8"));
}

const packageJson = JSON.parse(contents.get("package.json"));
if (packageJson.devDependencies?.["@shopify/cli"] !== "4.5.2") {
  throw new Error("@shopify/cli must be pinned exactly to 4.5.2");
}

const appConfig = contents.get("shopify.app.toml");
const requiredConfig = [
  'client_id = "TARGET_SHOPIFY_CLIENT_ID"',
  'application_url = "https://TARGET_WORKER_DOMAIN"',
  "embedded = false",
  'api_version = "2026-07"',
  'prefix = "apps"',
  'subpath = "jersey-configurator"',
  'url = "https://TARGET_WORKER_DOMAIN/apps/jersey-configurator"',
  '"https://TARGET_WORKER_DOMAIN/auth/callback"',
];
for (const expected of requiredConfig) {
  if (!appConfig.includes(expected)) throw new Error(`Missing app config: ${expected}`);
}

const scopesMatch = appConfig.match(/^\s*scopes\s*=\s*"([^"]*)"\s*$/m);
if (!scopesMatch) throw new Error("Missing access_scopes.scopes app config");

const expectedScopes = [
  "write_app_proxy",
  "write_cart_transforms",
  "write_cart_validations",
];
const configuredScopes = scopesMatch[1]
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean)
  .sort();
if (
  configuredScopes.length !== expectedScopes.length
  || configuredScopes.some((scope, index) => scope !== expectedScopes[index])
) {
  throw new Error(`Access scopes must be exactly: ${expectedScopes.join(",")}`);
}

const sourceCommit = "19ccafceda1d0052c2c90c0a1e4db3fe37b16c27";
const sourcePaths = [
  "checkout/rust/cart-transform/default",
  "checkout/rust/cart-checkout-validation/default",
];
const notice = contents.get("NOTICE.md");
for (const traceabilityValue of [sourceCommit, ...sourcePaths, "MIT"]) {
  if (!notice.includes(traceabilityValue)) {
    throw new Error(`NOTICE.md must identify upstream source: ${traceabilityValue}`);
  }
}

const licenseHash = createHash("sha256")
  .update(contents.get("LICENSE.shopify-function-examples.md"))
  .digest("hex");
if (licenseHash !== "03fde3ca1c31000b50d86635cc982c2957a44c95f153901d538830224a024125") {
  throw new Error("Shopify function-examples license must match the exact upstream LICENSE.md");
}

const targetChecks = new Map([
  ["extensions/secure-jersey-transform/shopify.extension.toml", 'target = "purchase.cart-transform.run"'],
  ["extensions/secure-jersey-validation/shopify.extension.toml", 'target = "purchase.validation.run"'],
]);
for (const [file, target] of targetChecks) {
  if (!contents.get(file).includes(target)) throw new Error(`Missing target in ${file}: ${target}`);
}

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (["node_modules", "target", ".shopify", ".git"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(path));
    else result.push(path);
  }
  return result;
}

const secretPatterns = [
  /shpat_[A-Za-z0-9_]+/g,
  /shpca_[A-Za-z0-9_]+/g,
  /shpss_[A-Za-z0-9_]+/g,
  /SHOPIFY_API_SECRET\s*=\s*[^\s]+/g,
  /SHOPIFY_ACCESS_TOKEN\s*=\s*[^\s]+/g,
];
for (const file of await collectFiles(root)) {
  const text = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) throw new Error(`Sensitive value pattern found in ${file}`);
    pattern.lastIndex = 0;
  }
}

if (/\.myshopify\.com/i.test(appConfig)) {
  throw new Error("A store-specific Shopify domain must not be committed");
}

console.log(`Scaffold verified: ${requiredFiles.length} required files, public placeholders only.`);
