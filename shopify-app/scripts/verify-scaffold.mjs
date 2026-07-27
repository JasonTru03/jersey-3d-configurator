import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "package.json",
  "package-lock.json",
  "shopify.app.toml",
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
  'scopes = "write_cart_transforms,write_cart_validations"',
  'api_version = "2026-07"',
  'prefix = "apps"',
  'subpath = "jersey-configurator"',
  'url = "https://TARGET_WORKER_DOMAIN/apps/jersey-configurator"',
  '"https://TARGET_WORKER_DOMAIN/auth/callback"',
];
for (const expected of requiredConfig) {
  if (!appConfig.includes(expected)) throw new Error(`Missing app config: ${expected}`);
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
