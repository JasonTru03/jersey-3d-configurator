import {readFile, readdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import {parse} from "smol-toml";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "package.json",
  "package-lock.json",
  ".gitignore",
  "shopify.app.toml",
  "rust-toolchain.toml",
  "LICENSE.shopify-function-examples.md",
  "NOTICE.md",
  "scripts/deploy.mjs",
  "scripts/deploy.test.mjs",
  "extensions/secure-jersey-transform/Cargo.lock",
  "extensions/secure-jersey-transform/Cargo.toml",
  "extensions/secure-jersey-transform/.gitignore",
  "extensions/secure-jersey-transform/shopify.extension.toml",
  "extensions/secure-jersey-transform/schema.graphql",
  "extensions/secure-jersey-transform/src/main.rs",
  "extensions/secure-jersey-transform/src/contract.rs",
  "extensions/secure-jersey-transform/src/run.graphql",
  "extensions/secure-jersey-transform/src/run.rs",
  "extensions/secure-jersey-validation/Cargo.lock",
  "extensions/secure-jersey-validation/Cargo.toml",
  "extensions/secure-jersey-validation/.gitignore",
  "extensions/secure-jersey-validation/shopify.extension.toml",
  "extensions/secure-jersey-validation/schema.graphql",
  "extensions/secure-jersey-validation/src/main.rs",
  "extensions/secure-jersey-validation/src/contract.rs",
  "extensions/secure-jersey-validation/src/run.graphql",
  "extensions/secure-jersey-validation/src/run.rs",
];

const contents = new Map();
for (const file of requiredFiles) {
  contents.set(file, await readFile(resolve(root, file), "utf8"));
}

if (!/^shopify\.app\.\*\.toml$/m.test(contents.get(".gitignore"))) {
  throw new Error("The app .gitignore must keep named store configs local");
}

const packageJson = JSON.parse(contents.get("package.json"));
if (packageJson.devDependencies?.["@shopify/cli"] !== "4.5.2") {
  throw new Error("@shopify/cli must be pinned exactly to 4.5.2");
}
if (packageJson.devDependencies?.["smol-toml"] !== "1.7.1") {
  throw new Error("smol-toml must be pinned exactly to 1.7.1");
}
if (packageJson.scripts?.deploy !== "node scripts/deploy.mjs") {
  throw new Error("deploy must run the guarded deployment script");
}
if (packageJson.scripts?.["deploy:check"] !== "node scripts/deploy.mjs --check-only") {
  throw new Error("deploy:check must run the guard without deploying");
}
if (packageJson.scripts?.["test:deploy"] !== "node --test scripts/deploy.test.mjs") {
  throw new Error("test:deploy must run the deployment guard tests");
}
if (!packageJson.scripts?.test?.includes("npm run test:deploy")) {
  throw new Error("the app test entrypoint must include the deployment guard tests");
}

const deployScript = contents.get("scripts/deploy.mjs");
for (const marker of [
  "npm run deploy -- CONFIG_NAME",
  "npm run deploy:check -- CONFIG_NAME",
  '["app", "deploy", "--config", configName]',
]) {
  if (!deployScript.includes(marker)) {
    throw new Error(`deploy script must contain: ${marker}`);
  }
}
if (deployScript.includes("--app-config")) {
  throw new Error("deploy script must use the PowerShell-safe positional config interface");
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const appConfigText = contents.get("shopify.app.toml");
const appConfig = parse(appConfigText);
assertEqual(appConfig.client_id, "TARGET_SHOPIFY_CLIENT_ID", "client_id");
assertEqual(appConfig.application_url, "https://TARGET_WORKER_DOMAIN", "application_url");
assertEqual(appConfig.embedded, false, "embedded");
assertEqual(appConfig.webhooks, {api_version: "2026-07"}, "webhooks section");
assertEqual(
  appConfig.auth,
  {redirect_urls: ["https://TARGET_WORKER_DOMAIN/auth/callback"]},
  "auth section",
);
assertEqual(
  appConfig.app_proxy,
  {
    prefix: "apps",
    subpath: "jersey-configurator",
    url: "https://TARGET_WORKER_DOMAIN/apps/jersey-configurator",
  },
  "app_proxy section",
);

const expectedScopes = [
  "read_cart_transforms",
  "read_validations",
  "write_app_proxy",
  "write_cart_transforms",
  "write_validations",
];
const configuredScopes = appConfig.access_scopes?.scopes
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean)
  .sort();
assertEqual(configuredScopes, expectedScopes, "access_scopes.scopes");

const toolchain = parse(contents.get("rust-toolchain.toml"));
assertEqual(
  toolchain.toolchain,
  {channel: "1.97.1", components: ["rustfmt", "clippy"], targets: ["wasm32-unknown-unknown"], profile: "minimal"},
  "rust toolchain",
);

const sourceCommit = "19ccafceda1d0052c2c90c0a1e4db3fe37b16c27";
const sourcePaths = [
  "checkout/rust/cart-transform/default",
  "checkout/rust/cart-checkout-validation/default",
];
const notice = contents.get("NOTICE.md");
const sourceDocs = [
  "https://shopify.dev/docs/api/functions/2026-07/cart-transform",
  "https://shopify.dev/docs/api/functions/2026-07/cart-and-checkout-validation",
];
for (const traceabilityValue of [sourceCommit, ...sourcePaths, ...sourceDocs, "MIT"]) {
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

const extensionChecks = new Map([
  ["extensions/secure-jersey-transform/shopify.extension.toml", {
    handle: "secure-jersey-transform",
    target: "cart.transform.run",
    resultType: "CartTransformRunResult",
    dependencies: {
      base64: "=0.22.1",
      hmac: "=0.12.1",
      serde_json: "=1.0.151",
      sha2: "=0.10.9",
      shopify_function: "=2.2.0",
    },
  }],
  ["extensions/secure-jersey-validation/shopify.extension.toml", {
    handle: "secure-jersey-validation",
    target: "cart.validations.generate.run",
    resultType: "CartValidationsGenerateRunResult",
    dependencies: {
      base64: "=0.22.1",
      hmac: "=0.12.1",
      serde_json: "=1.0.151",
      sha2: "=0.10.9",
      shopify_function: "=2.2.0",
    },
  }],
]);
for (const [file, expected] of extensionChecks) {
  const extensionConfig = parse(contents.get(file));
  assertEqual(extensionConfig.api_version, "2026-07", `${file} api_version`);
  assertEqual(extensionConfig.extensions?.length, 1, `${file} extensions count`);
  const extension = extensionConfig.extensions[0];
  assertEqual(extension.handle, expected.handle, `${file} handle`);
  assertEqual(extension.type, "function", `${file} type`);
  assertEqual(extension.targeting, [{
    target: expected.target,
    input_query: "src/run.graphql",
    export: "run",
  }], `${file} targeting`);
  assertEqual(extension.build, {
    command: "cargo build --target=wasm32-unknown-unknown --release",
    path: `target/wasm32-unknown-unknown/release/${expected.handle}.wasm`,
    watch: ["src/**/*.rs"],
  }, `${file} build`);

  const sourceFile = file.replace("shopify.extension.toml", "src/run.rs");
  const source = contents.get(sourceFile);
  for (const marker of ["#[shopify_function]", expected.resultType]) {
    if (!source.includes(marker)) throw new Error(`${sourceFile} must use current Rust template marker: ${marker}`);
  }

  const mainFile = file.replace("shopify.extension.toml", "src/main.rs");
  const main = contents.get(mainFile);
  for (const marker of ['#[typegen("schema.graphql")]', '#[query("src/run.graphql")]']) {
    if (!main.includes(marker)) throw new Error(`${mainFile} must use current Rust template marker: ${marker}`);
  }

  const schemaFile = file.replace("shopify.extension.toml", "schema.graphql");
  const schema = contents.get(schemaFile);
  const schemaMarkers = expected.handle.endsWith("validation")
    ? ["input Operation @oneOf", "validationAdd: ValidationAddOperation", "operations: [Operation!]!"]
    : ["input Operation @oneOf", "lineExpand:", "linesMerge:", "lineUpdate:"];
  for (const marker of ["# schema-version: 2026-07", `input ${expected.resultType}`, ...schemaMarkers]) {
    if (!schema.includes(marker)) throw new Error(`${schemaFile} must contain current schema marker: ${marker}`);
  }
  for (const legacyMarker of ["purchase.cart-transform.run", "purchase.validation.run", "FunctionRunResult"]) {
    if (schema.includes(legacyMarker)) throw new Error(`${schemaFile} contains legacy schema marker: ${legacyMarker}`);
  }

  const cargoFile = file.replace("shopify.extension.toml", "Cargo.toml");
  const cargoConfig = parse(contents.get(cargoFile));
  assertEqual(cargoConfig.dependencies, expected.dependencies, `${cargoFile} dependencies`);
  const lockFile = file.replace("shopify.extension.toml", "Cargo.lock");
  if (!/name = "shopify_function"\r?\nversion = "2\.2\.0"/.test(contents.get(lockFile))) {
    throw new Error(`${lockFile} must lock shopify_function 2.2.0`);
  }
  const ignoreFile = file.replace("shopify.extension.toml", ".gitignore");
  if (/^Cargo\.lock$/m.test(contents.get(ignoreFile))) {
    throw new Error(`${ignoreFile} must not ignore Cargo.lock`);
  }
}

if (
  contents.get("extensions/secure-jersey-validation/src/contract.rs")
  !== contents.get("extensions/secure-jersey-transform/src/contract.rs")
) {
  throw new Error("Cart Transform and Validation quote contracts must stay byte-for-byte identical");
}

if (/^Cargo\.lock$/m.test(contents.get(".gitignore"))) {
  throw new Error("The app .gitignore must not ignore Cargo.lock");
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

if (/\.myshopify\.com/i.test(appConfigText)) {
  throw new Error("A store-specific Shopify domain must not be committed");
}

console.log(`Scaffold verified: ${requiredFiles.length} required files, public placeholders only.`);
