import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findNativeCanvasBrowserPath({
  environment = process.env,
  exists = existsSync,
  platform = process.platform,
} = {}) {
  const candidates = [environment.CHROME_PATH, environment.BROWSER_PATH];
  if (platform === 'win32') {
    candidates.push(
      join(environment.ProgramFiles ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      join(environment.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      join(environment.ProgramFiles ?? 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
      join(environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    );
  }
  return candidates.filter(Boolean).find((candidate) => exists(candidate)) ?? null;
}

export function requireNativeCanvasBrowserPath(options) {
  const browserPath = findNativeCanvasBrowserPath(options);
  if (browserPath) return browserPath;
  throw new Error(
    'Native Canvas 测试必须安装 Chrome、Chromium 或 Edge；也可通过 CHROME_PATH/BROWSER_PATH 指定浏览器。',
  );
}

export function runNativeCanvasBrowser({
  argumentsList,
  browserPath = null,
  label = 'Native Canvas browser',
  maxBuffer = 10 * 1024 * 1024,
  spawn = spawnSync,
  timeout = 30_000,
} = {}) {
  const resolvedBrowserPath = browserPath ?? requireNativeCanvasBrowserPath();
  const result = spawn(resolvedBrowserPath, argumentsList, {
    encoding: 'utf8',
    maxBuffer,
    timeout,
  });
  const command = [resolvedBrowserPath, ...argumentsList].map(quoteCommandArgument).join(' ');
  if (result.error) {
    throw new Error(`${label} 无法启动。\n命令：${command}\n错误：${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error([
      `${label} 退出码为 ${result.status}。`,
      `命令：${command}`,
      `stdout：${result.stdout}`,
      `stderr：${result.stderr}`,
    ].join('\n'));
  }
  return { browserPath: resolvedBrowserPath, command, result };
}

function quoteCommandArgument(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}
