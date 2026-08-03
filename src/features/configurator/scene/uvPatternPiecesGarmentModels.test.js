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
const MAX_NORMALIZED_COVERAGE_DIFF = 0.025;
const DIRECTION_MARKER_COLORS = [
  [245, 85, 35],
  [35, 205, 95],
  [45, 95, 235],
];
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

  it('rejects output RGB drift even when both samples remain inside the target-color tolerance', () => {
    const evidence = createDirectionalEvidence({
      outputSamples: DIRECTION_MARKER_COLORS.map(([red, green, blue]) => [
        red + 1,
        green + 1,
        blue + 1,
        255,
      ]),
    });

    expect(() => expectDirectionalEvidence(evidence)).toThrow();
  });

  it('rejects normalized coverage drift that the previous implicit 0.05 tolerance accepted', () => {
    const evidence = createDirectionalEvidence({
      normalizedCoverage: {
        raw: [0.34, 0.33, 0.33],
        output: [0.37, 0.30, 0.33],
      },
    });

    expect(() => expectDirectionalEvidence(evidence)).toThrow();
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
      const maximumCoverageDifference = expectDirectionalEvidence(result.directionalEvidence);

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
        maximumCoverageDifference,
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
      createDesign(
        'front-player-set',
        'player-set',
        'front',
        [220, 30, 30],
        trianglesByRegion.front[0],
        { directionMarkerColors: DIRECTION_MARKER_COLORS },
      ),
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

function createDesign(id, kind, region, color, triangle, evidence = {}) {
  return { id, kind, region, color, triangle, ...evidence };
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
import { createUvPatternPieces } from ${JSON.stringify(moduleUrl)};

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

function triangleBounds(triangle) {
  const xValues = triangle.map(({ x }) => x);
  const yValues = triangle.map(({ y }) => y);
  return {
    x: Math.min(...xValues),
    y: Math.min(...yValues),
    width: Math.max(...xValues) - Math.min(...xValues),
    height: Math.max(...yValues) - Math.min(...yValues),
  };
}

function interpolate(first, second, amount) {
  return {
    x: first.x + (second.x - first.x) * amount,
    y: first.y + (second.y - first.y) * amount,
  };
}

function drawPlayerSet(context, design, outer) {
  context.fillStyle = 'rgb(' + design.color.join(',') + ')';
  traceTriangle(context, outer);
  context.fill();
  const center = average(outer);
  const bounds = triangleBounds(outer);
  context.save();
  traceTriangle(context, outer);
  context.clip();
  context.fillStyle = 'rgba(255,255,255,0.92)';
  context.fillRect(
    center.x - bounds.width * 0.18,
    center.y - bounds.height * 0.30,
    bounds.width * 0.36,
    Math.max(1, bounds.height * 0.08),
  );
  context.fillRect(
    center.x - bounds.width * 0.08,
    center.y + bounds.height * 0.12,
    bounds.width * 0.16,
    Math.max(1, bounds.height * 0.18),
  );
  context.restore();
}

function drawCustomText(context, design, outer) {
  const center = average(outer);
  context.strokeStyle = 'rgb(' + design.color.join(',') + ')';
  context.lineCap = 'round';
  context.lineWidth = Math.max(2, Math.min(triangleBounds(outer).width, triangleBounds(outer).height) * 0.14);
  context.beginPath();
  const capStart = interpolate(center, outer[0], 0.52);
  const capEnd = interpolate(center, outer[1], 0.52);
  const stemEnd = interpolate(center, outer[2], 0.48);
  context.moveTo(capStart.x, capStart.y);
  context.lineTo(capEnd.x, capEnd.y);
  context.moveTo(center.x, center.y);
  context.lineTo(stemEnd.x, stemEnd.y);
  context.stroke();
}

function drawPresetArtwork(context, design, outer) {
  const center = average(outer);
  const bounds = triangleBounds(outer);
  const outerRadius = Math.max(2, Math.min(bounds.width, bounds.height) * 0.28);
  const innerRadius = outerRadius * 0.42;
  context.fillStyle = 'rgb(' + design.color.join(',') + ')';
  context.beginPath();
  for (let pointIndex = 0; pointIndex < 10; pointIndex += 1) {
    const radius = pointIndex % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + pointIndex * Math.PI / 5;
    const point = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    if (pointIndex === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fill();
}

function drawTransparentUpload(context, design, outer) {
  context.fillStyle = 'rgb(' + design.color.join(',') + ')';
  traceTriangle(context, outer);
  context.fill();
  context.save();
  context.globalCompositeOperation = 'destination-out';
  traceTriangle(context, scaleTriangle(outer, 0.55));
  context.fill();
  context.restore();
}

function getDirectionMarker(design) {
  if (!design.directionMarkerColors) return null;
  const outer = scaleTriangle(toAtlasPoints(design.triangle), 0.78);
  const center = average(outer);
  return {
    colors: design.directionMarkerColors,
    halfSize: 3,
    points: outer.map((point) => {
      const markerPoint = interpolate(center, point, 0.48);
      return { x: Math.round(markerPoint.x), y: Math.round(markerPoint.y) };
    }),
  };
}

function drawDirectionMarker(context, marker) {
  if (!marker) return;
  marker.points.forEach((point, index) => {
    context.fillStyle = 'rgb(' + marker.colors[index].join(',') + ')';
    context.fillRect(
      point.x - marker.halfSize,
      point.y - marker.halfSize,
      marker.halfSize * 2 + 1,
      marker.halfSize * 2 + 1,
    );
  });
}

function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const context = canvas.getContext('2d');
  for (const design of fixture.designs) {
    const outer = scaleTriangle(toAtlasPoints(design.triangle), 0.78);
    switch (design.kind) {
      case 'custom-text':
        drawCustomText(context, design, outer);
        break;
      case 'preset-artwork':
        drawPresetArtwork(context, design, outer);
        break;
      case 'transparent-upload':
        drawTransparentUpload(context, design, outer);
        break;
      default:
        drawPlayerSet(context, design, outer);
    }
    drawDirectionMarker(context, getDirectionMarker(design));
  }
  return canvas;
}

function outputPointForCurrentLayout(piece, atlasPoint) {
  if (piece.rotation !== 0 || piece.mirrorX !== false) {
    throw new Error('真实模型测试的独立坐标公式只允许当前明确配置的 rotation=0/mirrorX=false。');
  }
  const relativeX = (atlasPoint.x - piece.sourceBounds.x) / piece.sourceBounds.width;
  const relativeY = (atlasPoint.y - piece.sourceBounds.y) / piece.sourceBounds.height;
  return {
    x: piece.outputBounds.x + relativeX * piece.outputBounds.width,
    y: piece.outputBounds.y + relativeY * piece.outputBounds.height,
  };
}

function outputPointForCounterfactual(piece, atlasPoint, counterfactual) {
  const relativeX = (atlasPoint.x - piece.sourceBounds.x) / piece.sourceBounds.width;
  const relativeY = (atlasPoint.y - piece.sourceBounds.y) / piece.sourceBounds.height;
  const outputRelative = counterfactual === 'mirrorX'
    ? { x: 1 - relativeX, y: relativeY }
    : { x: 1 - relativeX, y: 1 - relativeY };
  return {
    x: piece.outputBounds.x + outputRelative.x * piece.outputBounds.width,
    y: piece.outputBounds.y + outputRelative.y * piece.outputBounds.height,
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

function countSelectedColors(context, bounds, colors) {
  const image = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data;
  const counts = colors.map(() => 0);
  for (let offset = 0; offset < image.length; offset += 4) {
    if (image[offset + 3] < 200) continue;
    colors.forEach((color, colorIndex) => {
      if (color.every((channel, channelIndex) => Math.abs(image[offset + channelIndex] - channel) <= 12)) {
        counts[colorIndex] += 1;
      }
    });
  }
  return counts;
}

function normalizeCounts(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  return counts.map((count) => count / total);
}

function countMatchingSamples(samples, colors) {
  return samples.reduce((matches, sample, index) => (
    sample[3] > 200
    && colors[index].every((channel, channelIndex) => Math.abs(sample[channelIndex] - channel) <= 12)
      ? matches + 1
      : matches
  ), 0);
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
      outputPointForCurrentLayout(piecesById[design.region], {
        x: average(design.triangle).x * atlasSize,
        y: average(design.triangle).y * atlasSize,
      }),
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
  const directionDesign = fixture.designs.find(({ directionMarkerColors }) => directionMarkerColors);
  const directionMarker = getDirectionMarker(directionDesign);
  const rawDirectionCounts = countSelectedColors(
    atlasContext,
    { x: 0, y: 0, width: atlasSize, height: atlasSize },
    directionMarker.colors,
  );
  const outputDirectionCounts = countSelectedColors(
    outputContext,
    front.outputBounds,
    directionMarker.colors,
  );
  const mirrorSamples = directionMarker.points.map((point) => readPixel(
    outputContext,
    outputPointForCounterfactual(front, point, 'mirrorX'),
  ));
  const rotationSamples = directionMarker.points.map((point) => readPixel(
    outputContext,
    outputPointForCounterfactual(front, point, 'rotation180'),
  ));

  publish({
    ok: true,
    blob: { hasBytes: extracted.blob.size > 0, type: extracted.blob.type },
    designSamples,
    directionalEvidence: {
      counterfactualMatches: {
        mirrorX: countMatchingSamples(mirrorSamples, directionMarker.colors),
        rotation180: countMatchingSamples(rotationSamples, directionMarker.colors),
      },
      normalizedCoverage: {
        output: normalizeCounts(outputDirectionCounts),
        raw: normalizeCounts(rawDirectionCounts),
      },
      outputSamples: directionMarker.points.map((point) => readPixel(
        outputContext,
        outputPointForCurrentLayout(front, point),
      )),
      rawSamples: directionMarker.points.map((point) => readPixel(atlasContext, point)),
    },
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
      outputCenterAlpha: readPixel(outputContext, outputPointForCurrentLayout(front, {
        x: uploadCenter.x * atlasSize,
        y: uploadCenter.y * atlasSize,
      }))[3],
      rawCenterAlpha: readPixel(atlasContext, {
        x: uploadCenter.x * atlasSize,
        y: uploadCenter.y * atlasSize,
      })[3],
      ringAlphas: ringPoints.map((point) => readPixel(outputContext, outputPointForCurrentLayout(front, {
        x: point.x * atlasSize,
        y: point.y * atlasSize,
      }))[3]),
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

function createDirectionalEvidence(overrides = {}) {
  const exactSamples = DIRECTION_MARKER_COLORS.map((color) => [...color, 255]);
  return {
    counterfactualMatches: { mirrorX: 0, rotation180: 0 },
    normalizedCoverage: {
      raw: [0.34, 0.33, 0.33],
      output: [0.34, 0.33, 0.33],
    },
    outputSamples: exactSamples,
    rawSamples: exactSamples,
    ...overrides,
  };
}

function expectDirectionalEvidence(evidence) {
  expect(evidence, '缺少可识别旋转/镜像错误的非对称像素证据。').toBeDefined();
  evidence.rawSamples.forEach((rawSample, index) => {
    const outputSample = evidence.outputSamples[index];
    expectColor(rawSample, DIRECTION_MARKER_COLORS[index]);
    expectColor(outputSample, DIRECTION_MARKER_COLORS[index]);
    expect(outputSample.slice(0, 3)).toEqual(rawSample.slice(0, 3));
  });
  const coverageDifferences = evidence.normalizedCoverage.raw.map((rawCoverage, index) => (
    Math.abs(evidence.normalizedCoverage.output[index] - rawCoverage)
  ));
  coverageDifferences.forEach((difference) => {
    expect(difference).toBeLessThan(MAX_NORMALIZED_COVERAGE_DIFF);
  });
  expect(evidence.counterfactualMatches.mirrorX).toBe(0);
  expect(evidence.counterfactualMatches.rotation180).toBe(0);
  return Math.max(...coverageDifferences);
}
