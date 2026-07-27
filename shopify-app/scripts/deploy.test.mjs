import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;

function runDeploy(args) {
  assert.ok(npmCli, "npm_execpath must be available when run through npm");
  const result = spawnSync(
    process.execPath,
    [npmCli, "run", "deploy", "--", ...args],
    {cwd: root, encoding: "utf8"},
  );
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

test("rejects deployment without an app config", () => {
  const result = runDeploy(["--check-only"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /--app-config CONFIG_NAME/);
});

test("rejects a missing named app config", () => {
  const result = runDeploy(["--app-config", "test-missing-config", "--check-only"]);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /shopify\.app\.test-missing-config\.toml/);
});

test("rejects unresolved TARGET placeholders", async () => {
  const name = `test-placeholder-${process.pid}`;
  const path = resolve(root, `shopify.app.${name}.toml`);
  await writeFile(path, 'client_id = "TARGET_TEST_CLIENT_ID"\n', "utf8");
  try {
    const result = runDeploy(["--app-config", name, "--check-only"]);
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
    const result = runDeploy(["--app-config", name, "--check-only"]);
    assert.equal(result.status, 0, result.output);
  } finally {
    await rm(path);
  }
});
