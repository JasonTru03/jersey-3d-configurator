import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {parse} from "smol-toml";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const checkOnly = args[0] === "--check-only";
if (checkOnly) args.shift();

const [configName, ...extraArgs] = args;
if (
  extraArgs.length > 0
  || !configName
  || !/^[a-zA-Z0-9_-]+$/.test(configName)
) {
  throw new Error(
    "Deployment requires one named config: npm run deploy -- CONFIG_NAME "
    + "(check only: npm run deploy:check -- CONFIG_NAME)",
  );
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
