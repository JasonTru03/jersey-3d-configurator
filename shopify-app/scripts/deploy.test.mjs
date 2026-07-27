import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function runNpmScript(script, configName) {
  const result = process.platform === "win32"
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `& (Get-Command npm -CommandType ExternalScript).Source run ${script} --${configName ? ` ${configName}` : ""}`,
        ],
        {cwd: root, encoding: "utf8"},
      )
    : spawnSync(
        "npm",
        ["run", script, "--", ...(configName ? [configName] : [])],
        {cwd: root, encoding: "utf8"},
      );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

test("rejects deployment without an app config", () => {
  const result = runNpmScript("deploy");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /npm run deploy -- CONFIG_NAME/);
});

test("rejects a missing named app config", () => {
  const result = runNpmScript("deploy:check", "test-missing-config");
  assert.notEqual(result.status, 0);
  assert.match(result.output, /shopify\.app\.test-missing-config\.toml/);
});

test("rejects unresolved TARGET placeholders", async () => {
  const name = `test-placeholder-${process.pid}`;
  const path = resolve(root, `shopify.app.${name}.toml`);
  await writeFile(path, 'client_id = "TARGET_TEST_CLIENT_ID"\n', "utf8");
  try {
    const result = runNpmScript("deploy:check", name);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /unresolved TARGET_\*/);
  } finally {
    await rm(path);
  }
});

test("accepts a resolved named app config in check-only mode through npm", async () => {
  const name = `test-resolved-${process.pid}`;
  const path = resolve(root, `shopify.app.${name}.toml`);
  await writeFile(path, 'client_id = "resolved-client-id"\n', "utf8");
  try {
    const result = runNpmScript("deploy:check", name);
    assert.equal(result.status, 0, result.output);
  } finally {
    await rm(path);
  }
});
