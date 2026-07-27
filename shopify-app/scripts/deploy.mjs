import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {parse} from "smol-toml";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const checkOnlyIndex = args.indexOf("--check-only");
const checkOnly = checkOnlyIndex !== -1;
if (checkOnly) args.splice(checkOnlyIndex, 1);

const configIndex = args.findIndex((argument) => argument === "--config" || argument === "-c");
const configName = configIndex === -1 ? undefined : args[configIndex + 1];
if (!configName || configName.startsWith("-") || !/^[a-zA-Z0-9_-]+$/.test(configName)) {
  throw new Error("Deployment requires an explicit named config: npm run deploy -- --config CONFIG_NAME");
}

const configPath = resolve(root, `shopify.app.${configName}.toml`);
const configText = await readFile(configPath, "utf8");
parse(configText);
if (/TARGET_[A-Z0-9_]+/.test(configText)) {
  throw new Error(`Deployment config contains unresolved TARGET_* placeholders: ${configPath}`);
}

if (!checkOnly) {
  const executable = process.platform === "win32" ? "shopify.cmd" : "shopify";
  const executablePath = resolve(root, "node_modules", ".bin", executable);
  const result = spawnSync(executablePath, ["app", "deploy", "--config", configName], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
