import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as uvPatternPieces from './uvPatternPieces.js';

const { createUvPatternPieces } = uvPatternPieces;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UV pattern pieces', () => {
  it('extracts ordered front/back pieces into a fixed 4096 PNG with transparent gaps', async () => {
    const harness = installCanvasHarness();
    const result = await createUvPatternPieces(createInput(harness));

    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe('image/png');
    expect(result.canvas).toBe(harness.created[0]);
    expect(result).toMatchObject({
      width: 4096,
      height: 4096,
      layoutFingerprint: expect.any(String),
    });
    expect(result.pieces.map(({ id }) => id)).toEqual(['front', 'back']);
    expect(result.pieces.map(({ mappedTriangles }) => mappedTriangles)).toEqual([2, 2]);
    expect(result.pieces.every(({ coveragePixels }) => coveragePixels > 0)).toBe(true);

    const [front, back] = result.pieces;
    expect(front.outputBounds.x + front.outputBounds.width).toBeLessThan(back.outputBounds.x);
    expect(calls(harness.created, 'clip')).toHaveLength(2);
    expect(calls(harness.created, 'drawImage').filter(({ args }) => args[0] === harness.atlas)).toHaveLength(2);
    expectCoverageReadsStayInsidePieces(result, harness.created);
    expectTemporaryCanvasesReleased(result.canvas, harness.created);
  });

  it('honors indexed/non-indexed render spans, drawRange, material visibility, and V flip', async () => {
    const harness = installCanvasHarness();
    const front = createIndexedRectMesh('front-mesh');
    front.geometry.clearGroups();
    front.geometry.addGroup(0, 3, 0);
    front.geometry.addGroup(3, 3, 1);
    front.material = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    front.material[1].visible = false;
    const back = createRectMesh('back-mesh', 0, 0, 1, 1);
    back.geometry.setDrawRange(3, 3);
    const originalGroups = front.geometry.groups.map((group) => ({ ...group }));
    const originalDrawRange = { ...back.geometry.drawRange };

    const result = await createUvPatternPieces({
      atlasCanvas: harness.atlas,
      atlasSize: 64,
      meshes: [front, back],
      uvLayout: createLayout(),
      yieldControl: () => Promise.resolve(),
    });

    expect(result.pieces.map(({ mappedTriangles }) => mappedTriangles)).toEqual([1, 1]);
    expect(front.geometry.groups).toEqual(originalGroups);
    expect(back.geometry.drawRange).toEqual(originalDrawRange);
    expect(calls(harness.created, 'moveTo').length).toBeGreaterThan(0);
    expect(uvPatternPieces.uvToAtlasPoint, '应导出 uvToAtlasPoint 以固定 V 翻转契约').toBeTypeOf('function');
    expect(uvPatternPieces.uvToAtlasPoint({ u: 0.25, v: 0.75 }, 64)).toEqual({ x: 16, y: 16 });
  });

  it.each([
    [90, false, { x: 4, y: 0 }],
    [270, false, { x: 0, y: 2 }],
    [90, true, { x: 0, y: 0 }],
  ])('applies rotation %i and mirrorX=%s to rendered coordinates', async (rotation, mirrorX, expectedPoint) => {
    expect(uvPatternPieces.transformPiecePoint, '应导出 transformPiecePoint 以固定旋转/镜像坐标契约').toBeTypeOf('function');
    expect(uvPatternPieces.transformPiecePoint(
      { x: 0, y: 0 },
      { width: 2, height: 4, rotation, mirrorX },
    )).toEqual(expectedPoint);

    const harness = installCanvasHarness();
    const layout = createLayout();
    Object.assign(layout.pieceGroups[0], { rotation, mirrorX });
    const result = await createUvPatternPieces(createInput(harness, { uvLayout: layout }));
    const bounds = result.pieces[0].outputBounds;

    expect(bounds.width).toBeGreaterThan(bounds.height);
    expect(calls(harness.created, 'rotate')
      .some(({ args }) => equivalentAngle(args[0], rotation * Math.PI / 180))).toBe(true);
    expect(calls(harness.created, 'scale')
      .some(({ args }) => args[0] < 0)).toBe(mirrorX);
  });

  it.each([
    ['同组重复引用', (layout) => layout.pieceGroups[0].islandRefs.push({ meshName: 'front-mesh' })],
    ['跨组重复引用', (layout) => { layout.pieceGroups[1].islandRefs[0].meshName = 'front-mesh'; }],
  ])('rejects %s with a Chinese error', async (_, mutate) => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    mutate(layout);

    await expect(createUvPatternPieces(createInput(harness, { uvLayout: layout })))
      .rejects.toThrow('重复引用');
  });

  it('rejects missing and non-unique exact mesh-name matches', async () => {
    const harness = installCanvasHarness();
    const base = { atlasCanvas: harness.atlas, atlasSize: 64, uvLayout: createLayout() };

    await expect(createUvPatternPieces({
      ...base,
      meshes: [createRectMesh('front-mesh', 0, 0, 0.5, 1)],
    })).rejects.toThrow('找不到网格');
    await expect(createUvPatternPieces({
      ...base,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
      ],
    })).rejects.toThrow('不唯一');
  });

  it.each([
    ['退化 UV', () => createTriangleMesh('front-mesh', [[0, 0], [0.5, 0], [1, 0]])],
    ['隐藏单材质', () => {
      const mesh = createRectMesh('front-mesh', 0, 0, 0.5, 1);
      mesh.material.visible = false;
      return mesh;
    }],
  ])('rejects a group with no mapped triangles: %s', async (_, createFront) => {
    const harness = installCanvasHarness();

    await expect(createUvPatternPieces(createInput(harness, {
      meshes: [createFront(), createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }))).rejects.toThrow('裁片');
  });

  it('rejects transparent extracted pieces and releases temporary canvases', async () => {
    const harness = installCanvasHarness({ coverageAlpha: 0 });

    await expect(createUvPatternPieces(createInput(harness))).rejects.toThrow('裁片');
    expectTemporaryCanvasesReleased(harness.created[0], harness.created);
  });

  it('reports a Chinese error when Canvas toBlob returns null and releases temporary canvases', async () => {
    const harness = installCanvasHarness({ blob: null });

    await expect(createUvPatternPieces(createInput(harness))).rejects.toThrow('PNG');
    expectTemporaryCanvasesReleased(harness.created[0], harness.created);
  });

  it('renders only the first duplicateGroup and records stable aliases', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups[0].duplicateGroup = 'body-copy';
    layout.pieceGroups[1].duplicateGroup = 'body-copy';

    const result = await createUvPatternPieces(createInput(harness, { uvLayout: layout }));

    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]).toMatchObject({ id: 'front', aliases: ['back'] });
    expect(calls(harness.created, 'drawImage').filter(({ args }) => args[0] === harness.atlas)).toHaveLength(1);
  });

  it('yields between bounded triangle extraction batches', async () => {
    const harness = installCanvasHarness();
    const yieldControl = vi.fn(() => Promise.resolve());

    const result = await createUvPatternPieces(createInput(harness, {
      meshes: [createRepeatedTrianglesMesh('front-mesh', 300), createRectMesh('back-mesh', 0.5, 0, 1, 1)],
      yieldControl,
    }));

    expect(result.pieces[0].mappedTriangles).toBe(300);
    expect(yieldControl.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps source atlasSize=64 separate from 4096 output coordinates', async () => {
    const harness = installCanvasHarness();
    const result = await createUvPatternPieces(createInput(harness));

    expect(result.pieces.every(({ sourceBounds }) => sourceBounds.x + sourceBounds.width <= 64)).toBe(true);
    expect(result.pieces.some(({ outputBounds }) => outputBounds.width > 64)).toBe(true);
    expect(result).toMatchObject({ width: 4096, height: 4096 });
  });

  it('creates a deterministic fingerprint that changes with layout transforms', async () => {
    const first = await createFingerprintResult(0);
    const second = await createFingerprintResult(0);
    const rotated = await createFingerprintResult(90);

    expect(first).toEqual(expect.any(String));
    expect(first).toBe(second);
    expect(rotated).not.toBe(first);
  });
});

async function createFingerprintResult(rotation) {
  const harness = installCanvasHarness();
  const layout = createLayout();
  layout.pieceGroups[0].rotation = rotation;
  const { layoutFingerprint } = await createUvPatternPieces(createInput(harness, { uvLayout: layout }));
  vi.restoreAllMocks();
  return layoutFingerprint;
}

function createInput(harness, overrides = {}) {
  return {
    atlasCanvas: harness.atlas,
    atlasSize: 64,
    meshes: [
      createRectMesh('front-mesh', 0, 0, 0.5, 1),
      createRectMesh('back-mesh', 0.5, 0, 1, 1),
    ],
    uvLayout: createLayout(),
    yieldControl: () => Promise.resolve(),
    ...overrides,
  };
}

function installCanvasHarness({
  blob = new Blob(['png'], { type: 'image/png' }),
  coverageAlpha = 255,
} = {}) {
  const atlas = new RecordingCanvas({ role: 'atlas', coverageAlpha });
  atlas.width = 64;
  atlas.height = 64;
  const created = [];
  const nativeCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    if (tagName !== 'canvas') return nativeCreateElement(tagName, options);
    const canvas = new RecordingCanvas({ blob, coverageAlpha, role: 'generated' });
    created.push(canvas);
    return canvas;
  });
  return { atlas, created };
}

class RecordingCanvas {
  constructor({
    blob = new Blob(['png'], { type: 'image/png' }),
    coverageAlpha = 255,
    role,
  } = {}) {
    this.width = 0;
    this.height = 0;
    this.role = role;
    this.blob = blob;
    this.context = new RecordingContext(this, coverageAlpha);
    this.operations = [];
  }

  getContext(type) {
    this.operations.push({ method: 'getContext', args: [type] });
    return type === '2d' ? this.context : null;
  }

  toBlob(callback, type) {
    this.operations.push({ method: 'toBlob', args: [type] });
    callback(this.blob);
  }
}

class RecordingContext {
  constructor(canvas, coverageAlpha) {
    this.canvas = canvas;
    this.coverageAlpha = coverageAlpha;
    this.operations = [];
  }

  record(method, args) {
    this.operations.push({ method, args: [...args], canvas: this.canvas });
  }

  save(...args) { this.record('save', args); }
  restore(...args) { this.record('restore', args); }
  beginPath(...args) { this.record('beginPath', args); }
  closePath(...args) { this.record('closePath', args); }
  moveTo(...args) { this.record('moveTo', args); }
  lineTo(...args) { this.record('lineTo', args); }
  clip(...args) { this.record('clip', args); }
  drawImage(...args) { this.record('drawImage', args); }
  translate(...args) { this.record('translate', args); }
  rotate(...args) { this.record('rotate', args); }
  scale(...args) { this.record('scale', args); }
  transform(...args) { this.record('transform', args); }
  setTransform(...args) { this.record('setTransform', args); }
  clearRect(...args) { this.record('clearRect', args); }

  getImageData(...args) {
    this.record('getImageData', args);
    const alpha = typeof this.coverageAlpha === 'function'
      ? this.coverageAlpha(...args)
      : this.coverageAlpha;
    return {
      data: Uint8ClampedArray.of(0, 0, 0, alpha),
      width: 1,
      height: 1,
    };
  }
}

function calls(canvases, method) {
  return canvases.flatMap((canvas) => canvas.context.operations)
    .filter((operation) => operation.method === method);
}

function expectCoverageReadsStayInsidePieces(result, canvases) {
  const reads = calls(canvases, 'getImageData');
  expect(reads.length).toBeGreaterThan(0);
  for (const { args: [x, y, width, height] } of reads) {
    expect([x, y, width, height]).not.toEqual([0, 0, 4096, 4096]);
    expect(result.pieces.some(({ outputBounds }) => (
      x >= outputBounds.x
      && y >= outputBounds.y
      && x + width <= outputBounds.x + outputBounds.width
      && y + height <= outputBounds.y + outputBounds.height
    ))).toBe(true);
  }
}

function expectTemporaryCanvasesReleased(outputCanvas, created) {
  expect(created.filter((canvas) => canvas !== outputCanvas)
    .every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
}

function equivalentAngle(left, right) {
  const turn = Math.PI * 2;
  const difference = ((left - right) % turn + turn) % turn;
  return difference < 1e-9 || Math.abs(difference - turn) < 1e-9;
}

function createMesh(name, uvs, indices = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    Array.from({ length: uvs.length }, () => [0, 0, 0]).flat(),
    3,
  ));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  if (indices) geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

function createRectMesh(name, minU, minV, maxU, maxV) {
  return createMesh(name, [
    [minU, minV], [maxU, minV], [minU, maxV],
    [maxU, minV], [maxU, maxV], [minU, maxV],
  ]);
}

function createIndexedRectMesh(name) {
  return createMesh(name, [[0, 0], [1, 0], [0, 1], [1, 1]], [0, 1, 2, 1, 3, 2]);
}

function createTriangleMesh(name, uvs) {
  return createMesh(name, uvs);
}

function createRepeatedTrianglesMesh(name, count) {
  return createMesh(name, Array.from({ length: count }, () => [[0, 0], [0.49, 0], [0, 1]]).flat());
}

function createLayout() {
  return {
    version: 1,
    pieceGroups: [
      createGroup('front', '正片', 0, 'front-mesh'),
      createGroup('back', '背片', 1, 'back-mesh'),
    ],
  };
}

function createGroup(id, label, order, meshName) {
  return {
    id,
    label,
    order,
    zone: 'body',
    rotation: 0,
    mirrorX: false,
    islandRefs: [{ meshName }],
  };
}
