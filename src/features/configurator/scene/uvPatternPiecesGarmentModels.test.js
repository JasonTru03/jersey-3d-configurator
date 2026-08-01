import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getModelUvLayout } from '../config/modelUvLayouts.js';
import {
  loadRealGarmentMeshes,
  REAL_GARMENT_MODELS,
} from './realGarmentModelTestHelpers.js';
import { collectRenderableUvTriangles } from './renderableUvTriangles.js';

const ATLAS_SIZE = 2048;
const CHROME_PATH = findBrowserPath();
const loadedModels = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all(REAL_GARMENT_MODELS.map(async ({ assetName, model }) => {
    const meshes = await loadRealGarmentMeshes(assetName);
    const uvLayout = getModelUvLayout(model);
    loadedModels.set(model.id, createBrowserFixture(meshes, uvLayout));
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('UV pattern pieces on supported real garment models', () => {
  it('resolves an installed browser on Windows for native pixel verification', () => {
    if (process.platform === 'win32') expect(CHROME_PATH).toBeTruthy();
  });

  const browserIt = CHROME_PATH ? it : it.skip;
  browserIt.each(REAL_GARMENT_MODELS)(
    'extracts isolated front/back design content from $model.id@$model.version',
    ({ assetName, model }) => {
      const result = runBrowserExtraction({
        assetName,
        fixture: loadedModels.get(model.id),
        model,
      });

      expect(result.ok, result.error).toBe(true);
      expect(result.pieceIds).toEqual(['front', 'back']);
      expect(result.pieces).toHaveLength(2);
      expect(result.blob).toMatchObject({ hasBytes: true, type: 'image/png' });
      expect(result.gapAlpha).toBe(0);
      expect(result.uploadTransparency).toMatchObject({
        outputCenterAlpha: 0,
        rawCenterAlpha: 0,
      });
      expect(result.uploadTransparency.ringAlphas.every((alpha) => alpha > 200)).toBe(true);

      const fixture = loadedModels.get(model.id);
      for (const piece of result.pieces) {
        const configured = fixture.uvLayout.pieceGroups.find(({ id }) => id === piece.id);
        expect(piece).toMatchObject({
          aliases: [],
          mirrorX: configured.mirrorX,
          rotation: configured.rotation,
          sourceMeshes: configured.islandRefs.map(({ meshName }) => meshName),
        });
        expect(piece.mappedTriangles).toBe(fixture.expectedTriangles[piece.id]);
        expect(piece.coveragePixels).toBeGreaterThan(0);
      }

      for (const design of fixture.designs) {
        expect(result.rawColorCounts[design.id]).toBeGreaterThan(0);
        expect(result.pieceColorCounts[design.region][design.id]).toBeGreaterThan(0);
        const oppositeRegion = design.region === 'front' ? 'back' : 'front';
        expect(result.pieceColorCounts[oppositeRegion][design.id]).toBe(0);
        if (design.kind !== 'transparent-upload') {
          expectColor(result.designSamples[design.id], design.color);
        }
      }

      console.info('UV real-model pieces', {
        model: `${model.id}@${model.version}`,
        assetName,
        pieces: result.pieces.map((piece) => ({
          id: piece.id,
          coveragePixels: piece.coveragePixels,
          mappedTriangles: piece.mappedTriangles,
        })),
      });
    },
    60_000,
  );
});

function createBrowserFixture(meshes, uvLayout) {
  const expectedTriangles = {};
  const serializedMeshes = [];
  const trianglesByRegion = {};
  for (const group of uvLayout.pieceGroups) {
    const mesh = meshes.find(({ name }) => name === group.islandRefs[0].meshName);
    const triangleData = collectRenderableUvTriangles(mesh);
    expectedTriangles[group.id] = triangleData.triangleCount;
    trianglesByRegion[group.id] = selectSeparatedTriangles(triangleData.coordinates, 3);
    serializedMeshes.push(serializeMeshWithDuplicateDrawGroups(mesh));
  }
  return {
    designs: [
      createDesign('front-player-set', 'player-set', 'front', [220, 30, 30], trianglesByRegion.front[0]),
      createDesign('front-preset-artwork', 'preset-artwork', 'front', [30, 190, 60], trianglesByRegion.front[1]),
      createDesign('front-transparent-upload', 'transparent-upload', 'front', [210, 40, 190], trianglesByRegion.front[2]),
      createDesign('back-player-set', 'player-set', 'back', [25, 80, 220], trianglesByRegion.back[0]),
      createDesign('back-custom-text', 'custom-text', 'back', [20, 190, 210], trianglesByRegion.back[1]),
    ],
    expectedTriangles,
    meshes: serializedMeshes,
    uvLayout,
  };
}

function createDesign(id, kind, region, color, triangle) {
  return { id, kind, region, color, triangle };
}

function selectSeparatedTriangles(coordinates, count) {
  const candidates = [];
  for (let offset = 0; offset < coordinates.length; offset += 6) {
    const triangle = [
      { x: coordinates[offset], y: 1 - coordinates[offset + 1] },
      { x: coordinates[offset + 2], y: 1 - coordinates[offset + 3] },
      { x: coordinates[offset + 4], y: 1 - coordinates[offset + 5] },
    ];
    const area = Math.abs(
      (triangle[1].x - triangle[0].x) * (triangle[2].y - triangle[0].y)
      - (triangle[1].y - triangle[0].y) * (triangle[2].x - triangle[0].x),
    );
    const center = averagePoints(triangle);
    candidates.push({ area, center, triangle });
  }
  candidates.sort((left, right) => right.area - left.area);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(({ center }) => distance(center, candidate.center) > 0.035)) {
      selected.push(candidate);
      if (selected.length === count) break;
    }
  }
  if (selected.length !== count) throw new Error('真实模型没有足够的分离 UV 三角形用于设计证据。');
  return selected.map(({ triangle }) => triangle);
}

function averagePoints(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function serializeMeshWithDuplicateDrawGroups(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const index = mesh.geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  return {
    name: mesh.name,
    index: index ? Array.from(index.array) : null,
    position: Array.from(position.array),
    uv: Array.from(uv.array),
    groups: [
      { count: elementCount, materialIndex: 0, start: 0 },
      { count: elementCount, materialIndex: 0, start: 0 },
    ],
  };
}

function runBrowserExtraction({ assetName, fixture, model }) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'uv-real-models-'));
  try {
    const htmlPath = join(temporaryDirectory, 'real-model.html');
    const moduleUrl = pathToFileURL(resolvePath(
      process.cwd(),
      'src/features/configurator/scene/uvPatternPieces.js',
    )).href;
    writeFileSync(htmlPath, createBrowserHtml(moduleUrl, fixture), 'utf8');
    const argumentsList = [
      '--headless=new',
      '--allow-file-access-from-files',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-background-networking',
      `--user-data-dir=${join(temporaryDirectory, 'chrome-profile')}`,
      '--virtual-time-budget=30000',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ];
    const processResult = spawnSync(CHROME_PATH, argumentsList, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: 50_000,
    });
    if (processResult.error || processResult.status !== 0) {
      throw new Error([
        `真实模型 ${assetName} 的 Chrome UV 裁片测试失败。`,
        `模型：${model.id}@${model.version}`,
        `错误：${processResult.error?.message ?? `exit ${processResult.status}`}`,
        `stdout：${processResult.stdout}`,
        `stderr：${processResult.stderr}`,
      ].join('\n'));
    }
    const marker = 'UV_REAL_MODEL:';
    const markerStart = processResult.stdout.indexOf(marker);
    const markerEnd = processResult.stdout.indexOf('</body>', markerStart);
    if (markerStart < 0 || markerEnd < 0) {
      throw new Error(`真实模型 ${assetName} 未返回 UV 裁片结果。\n${processResult.stdout}`);
    }
    return JSON.parse(processResult.stdout.slice(markerStart + marker.length, markerEnd));
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function createBrowserHtml(moduleUrl, fixture) {
  return `<!doctype html>
<html>
<body>UV_REAL_MODEL:{"ok":false,"error":"module did not finish"}</body>
<script type="module">
import { createUvPatternPieces, transformPiecePoint } from ${JSON.stringify(moduleUrl)};

const fixture = ${JSON.stringify(fixture)};
const atlasSize = ${ATLAS_SIZE};

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

function restoreMesh(serialized) {
  const position = createAttribute(serialized.position, 3);
  const uv = createAttribute(serialized.uv, 2);
  const index = serialized.index ? createAttribute(serialized.index, 1) : null;
  const geometry = {
    attributes: { position, uv },
    drawRange: { count: Infinity, start: 0 },
    groups: serialized.groups,
    getAttribute(name) { return this.attributes[name]; },
    getIndex() { return index; },
  };
  return { geometry, material: [{ visible: true }], name: serialized.name };
}

function scaleTriangle(triangle, factor) {
  const center = average(triangle);
  return triangle.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
}

function average(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function toAtlasPoints(triangle) {
  return triangle.map((point) => ({ x: point.x * atlasSize, y: point.y * atlasSize }));
}

function traceTriangle(context, triangle) {
  context.beginPath();
  context.moveTo(triangle[0].x, triangle[0].y);
  context.lineTo(triangle[1].x, triangle[1].y);
  context.lineTo(triangle[2].x, triangle[2].y);
  context.closePath();
}

function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const context = canvas.getContext('2d');
  for (const design of fixture.designs) {
    const outer = scaleTriangle(toAtlasPoints(design.triangle), 0.78);
    context.fillStyle = 'rgb(' + design.color.join(',') + ')';
    traceTriangle(context, outer);
    context.fill();
    if (design.kind === 'transparent-upload') {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      traceTriangle(context, scaleTriangle(outer, 0.55));
      context.fill();
      context.restore();
    }
  }
  return canvas;
}

function orientedSize(piece) {
  const { width, height } = piece.sourceBounds;
  const points = [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height },
  ].map((point) => transformPiecePoint(point, {
    width,
    height,
    mirrorX: piece.mirrorX,
    rotation: piece.rotation,
  }));
  return {
    width: Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)),
    height: Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)),
  };
}

function outputPoint(piece, normalizedPoint) {
  const sourcePoint = {
    x: normalizedPoint.x * atlasSize - piece.sourceBounds.x,
    y: normalizedPoint.y * atlasSize - piece.sourceBounds.y,
  };
  const transformed = transformPiecePoint(sourcePoint, {
    width: piece.sourceBounds.width,
    height: piece.sourceBounds.height,
    mirrorX: piece.mirrorX,
    rotation: piece.rotation,
  });
  const size = orientedSize(piece);
  return {
    x: piece.outputBounds.x + transformed.x * piece.outputBounds.width / size.width,
    y: piece.outputBounds.y + transformed.y * piece.outputBounds.height / size.height,
  };
}

function readPixel(context, point) {
  return [...context.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data];
}

function countColors(context, bounds) {
  const image = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data;
  const counts = Object.fromEntries(fixture.designs.map(({ id }) => [id, 0]));
  for (let offset = 0; offset < image.length; offset += 4) {
    if (image[offset + 3] < 200) continue;
    for (const design of fixture.designs) {
      if (design.color.every((channel, index) => Math.abs(image[offset + index] - channel) <= 12)) {
        counts[design.id] += 1;
        break;
      }
    }
  }
  return counts;
}

function publish(result) {
  document.body.textContent = 'UV_REAL_MODEL:' + JSON.stringify(result);
}

try {
  const atlasCanvas = createAtlas();
  const meshes = fixture.meshes.map(restoreMesh);
  const extracted = await createUvPatternPieces({
    atlasCanvas,
    atlasSize,
    meshes,
    uvLayout: fixture.uvLayout,
    yieldControl: () => Promise.resolve(),
  });
  const atlasContext = atlasCanvas.getContext('2d');
  const outputContext = extracted.canvas.getContext('2d');
  const piecesById = Object.fromEntries(extracted.pieces.map((piece) => [piece.id, piece]));
  const rawColorCounts = countColors(atlasContext, { x: 0, y: 0, width: atlasSize, height: atlasSize });
  const pieceColorCounts = Object.fromEntries(extracted.pieces.map((piece) => [
    piece.id,
    countColors(outputContext, piece.outputBounds),
  ]));
  const designSamples = {};
  for (const design of fixture.designs) {
    if (design.kind === 'transparent-upload') continue;
    designSamples[design.id] = readPixel(
      outputContext,
      outputPoint(piecesById[design.region], average(design.triangle)),
    );
  }
  const upload = fixture.designs.find(({ kind }) => kind === 'transparent-upload');
  const uploadCenter = average(upload.triangle);
  const ringPoints = scaleTriangle(upload.triangle, 0.60);
  const front = piecesById.front;
  const back = piecesById.back;
  const gapPoint = {
    x: (front.outputBounds.x + front.outputBounds.width + back.outputBounds.x) / 2,
    y: extracted.height / 2,
  };

  publish({
    ok: true,
    blob: { hasBytes: extracted.blob.size > 0, type: extracted.blob.type },
    designSamples,
    gapAlpha: readPixel(outputContext, gapPoint)[3],
    pieceColorCounts,
    pieceIds: extracted.pieces.map(({ id }) => id),
    pieces: extracted.pieces.map((piece) => ({
      aliases: piece.aliases,
      coveragePixels: piece.coveragePixels,
      id: piece.id,
      mappedTriangles: piece.mappedTriangles,
      mirrorX: piece.mirrorX,
      rotation: piece.rotation,
      sourceMeshes: piece.sourceMeshes,
    })),
    rawColorCounts,
    uploadTransparency: {
      outputCenterAlpha: readPixel(outputContext, outputPoint(front, uploadCenter))[3],
      rawCenterAlpha: readPixel(atlasContext, {
        x: uploadCenter.x * atlasSize,
        y: uploadCenter.y * atlasSize,
      })[3],
      ringAlphas: ringPoints.map((point) => readPixel(outputContext, outputPoint(front, point))[3]),
    },
  });
} catch (error) {
  publish({ ok: false, error: error?.stack ?? String(error) });
}
</script>
</html>`;
}

function findBrowserPath(environment = process.env, platform = process.platform) {
  const candidates = [environment.CHROME_PATH, environment.BROWSER_PATH];
  if (platform === 'win32') {
    candidates.push(
      join(environment.ProgramFiles ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
      join(environment['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
      join(environment.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
      join(environment.ProgramFiles ?? 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge');
  }
  return candidates.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
}

function expectColor(actual, expected) {
  expected.forEach((channel, index) => {
    expect(Math.abs(actual[index] - channel)).toBeLessThanOrEqual(12);
  });
  expect(actual[3]).toBeGreaterThan(200);
}
