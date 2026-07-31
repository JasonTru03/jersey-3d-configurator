import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const CHROME_PATH = findBrowserPath();

describe('UV pattern pieces Chrome smoke', () => {
  it('resolves an installed browser on Windows instead of skipping the smoke', () => {
    if (process.platform === 'win32') expect(CHROME_PATH).toBeTruthy();
  });

  const browserIt = CHROME_PATH ? it : it.skip;
  browserIt('runs the public extraction pipeline against native Canvas and Blob', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'uv-pattern-pieces-'));
    try {
      const htmlPath = join(temporaryDirectory, 'smoke.html');
      const moduleUrl = pathToFileURL(resolve(
        process.cwd(),
        'src/features/configurator/scene/uvPatternPieces.js',
      )).href;
      writeFileSync(htmlPath, createSmokeHtml(moduleUrl), 'utf8');
      const profilePath = join(temporaryDirectory, 'chrome-profile');
      const argumentsList = [
        '--headless=new',
        '--allow-file-access-from-files',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-background-networking',
        `--user-data-dir=${profilePath}`,
        '--virtual-time-budget=15000',
        '--dump-dom',
        pathToFileURL(htmlPath).href,
      ];
      const result = spawnSync(CHROME_PATH, argumentsList, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });
      const command = [CHROME_PATH, ...argumentsList].map(quoteCommandArgument).join(' ');
      if (result.error) {
        throw new Error(`Chrome smoke 无法启动。\n命令：${command}\n错误：${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error([
          `Chrome smoke 退出码为 ${result.status}。`,
          `命令：${command}`,
          `stdout：${result.stdout}`,
          `stderr：${result.stderr}`,
        ].join('\n'));
      }

      const marker = 'UV_SMOKE:';
      const markerStart = result.stdout.indexOf(marker);
      const markerEnd = result.stdout.indexOf('</body>', markerStart);
      if (markerStart < 0 || markerEnd < 0) {
        throw new Error([
          'Chrome smoke 未返回结果标记。',
          `命令：${command}`,
          `stdout：${result.stdout}`,
          `stderr：${result.stderr}`,
        ].join('\n'));
      }
      const smokeResult = JSON.parse(result.stdout.slice(markerStart + marker.length, markerEnd));
      console.info('UV Chrome smoke', {
        browserPath: CHROME_PATH,
        sharedEdgeAlphas: smokeResult.sharedEdgeAlphas,
      });
      expect(smokeResult.ok, smokeResult.error).toBe(true);
      expectOpaqueColor(smokeResult.frontInside, [255, 0, 0]);
      expect(smokeResult.frontOutside).toEqual([0, 0, 0, 0]);
      [
        [255, 0, 0],
        [0, 0, 255],
        [0, 255, 0],
        [255, 255, 0],
      ].forEach((color, index) => expectOpaqueColor(smokeResult.backCorners[index], color));
      for (const alpha of smokeResult.sharedEdgeAlphas) expect(alpha).toBeGreaterThanOrEqual(250);
      expect(smokeResult.blobType).toBe('image/png');
      expect(smokeResult.blobHasBytes).toBe(true);
      expect(smokeResult.atlasMismatchRejected).toBe(true);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  }, 40_000);
});

function findBrowserPath(environment = process.env, platform = process.platform) {
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
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
}

function quoteCommandArgument(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function expectOpaqueColor(actual, expectedRgb) {
  expectedRgb.forEach((channel, index) => {
    if (channel === 255) {
      expect(actual[index], JSON.stringify({ actual, expectedRgb })).toBeGreaterThanOrEqual(240);
    } else {
      expect(actual[index], JSON.stringify({ actual, expectedRgb })).toBeLessThanOrEqual(15);
    }
  });
  expect(actual[3], JSON.stringify({ actual, expectedRgb })).toBeGreaterThanOrEqual(240);
}

function createSmokeHtml(moduleUrl) {
  return `<!doctype html>
<html>
<body>UV_SMOKE:{"ok":false,"error":"module did not finish"}</body>
<script type="module">
import { createUvPatternPieces } from ${JSON.stringify(moduleUrl)};

function createAttribute(values, itemSize) {
  return {
    count: values.length / itemSize,
    itemSize,
    normalized: false,
    version: 0,
    getX(index) { return values[index * itemSize]; },
    getY(index) { return values[index * itemSize + 1]; },
    getZ(index) { return values[index * itemSize + 2]; },
  };
}

function createMesh(name, uvs) {
  const position = createAttribute(new Array(uvs.length / 2 * 3).fill(0), 3);
  const uv = createAttribute(uvs, 2);
  const geometry = {
    attributes: { position, uv },
    drawRange: { start: 0, count: Infinity },
    groups: [],
    getAttribute(attributeName) { return this.attributes[attributeName]; },
    getIndex() { return null; },
  };
  return { name, geometry, material: { visible: true } };
}

function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, 16, 16);
  context.fillStyle = '#00ff00';
  context.fillRect(16, 0, 16, 16);
  context.fillStyle = '#0000ff';
  context.fillRect(0, 16, 16, 16);
  context.fillStyle = '#ffff00';
  context.fillRect(16, 16, 16, 16);
  return canvas;
}

function readRelativePixel(context, bounds, relativeX, relativeY) {
  const x = Math.floor(bounds.x + relativeX * (bounds.width - 1));
  const y = Math.floor(bounds.y + relativeY * (bounds.height - 1));
  return [...context.getImageData(x, y, 1, 1).data];
}

function publish(result) {
  document.body.textContent = 'UV_SMOKE:' + JSON.stringify(result);
}

try {
  const atlasCanvas = createAtlas();
  const frontTriangle = [0, 1, 1, 1, 0, 0];
  const reverseFrontTriangle = [0, 0, 1, 1, 0, 1];
  const frontUvs = Array.from({ length: 128 }, (_, index) => (
    index % 2 === 0 ? frontTriangle : reverseFrontTriangle
  )).flat();
  frontUvs.push(0.75, 1, 1, 1, 1, 0.75);
  const front = createMesh('front-mesh', frontUvs);
  const back = createMesh('back-mesh', [
    0, 1, 1, 1, 0, 0,
    1, 1, 1, 0, 0, 0,
  ]);
  const uvLayout = {
    version: 1,
    pieceGroups: [
      {
        id: 'front', label: 'front', order: 0, zone: 'body', rotation: 0, mirrorX: false,
        islandRefs: [{ meshName: 'front-mesh' }],
      },
      {
        id: 'back', label: 'back', order: 1, zone: 'body', rotation: 90, mirrorX: true,
        islandRefs: [{ meshName: 'back-mesh' }],
      },
    ],
  };
  const input = {
    atlasCanvas,
    atlasSize: 32,
    meshes: [front, back],
    uvLayout,
    yieldControl: () => Promise.resolve(),
  };
  const extracted = await createUvPatternPieces(input);
  const outputContext = extracted.canvas.getContext('2d');
  const [frontPiece, backPiece] = extracted.pieces;
  let atlasMismatchRejected = false;
  try {
    await createUvPatternPieces({ ...input, atlasSize: 31 });
  } catch (error) {
    atlasMismatchRejected = error instanceof Error && error.message.includes('Atlas');
  }

  publish({
    ok: true,
    frontInside: readRelativePixel(outputContext, frontPiece.outputBounds, 0.2, 0.2),
    frontOutside: readRelativePixel(outputContext, frontPiece.outputBounds, 0.8, 0.8),
    backCorners: [
      readRelativePixel(outputContext, backPiece.outputBounds, 0.25, 0.25),
      readRelativePixel(outputContext, backPiece.outputBounds, 0.85, 0.35),
      readRelativePixel(outputContext, backPiece.outputBounds, 0.35, 0.85),
      readRelativePixel(outputContext, backPiece.outputBounds, 0.75, 0.75),
    ],
    sharedEdgeAlphas: [0.25, 0.5, 0.75].map((position) => (
      readRelativePixel(outputContext, backPiece.outputBounds, position, 1 - position)[3]
    )),
    blobType: extracted.blob.type,
    blobHasBytes: extracted.blob.size > 0,
    atlasMismatchRejected,
  });
} catch (error) {
  publish({ ok: false, error: error?.stack ?? String(error) });
}
</script>
</html>`;
}
