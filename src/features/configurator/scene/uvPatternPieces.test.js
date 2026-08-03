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
      outputTransform: { rotation: 0, mirrorX: false },
      layoutFingerprint: expect.any(String),
    });
    expect(result.pieces.map(({ id }) => id)).toEqual(['front', 'back']);
    expect(result.pieces.map(({ mappedTriangles }) => mappedTriangles)).toEqual([2, 2]);
    expect(result.pieces.every(({ coveragePixels }) => coveragePixels > 0)).toBe(true);

    const [front, back] = result.pieces;
    expect(front.outputBounds.x + front.outputBounds.width).toBeLessThan(back.outputBounds.x);
    expect(calls(harness.created, 'clip')).toHaveLength(0);
    expect(calls(harness.created, 'fill')).toHaveLength(2);
    expect(calls(harness.created, 'drawImage').filter(({ args }) => args[0] === harness.atlas)).toHaveLength(2);
    expect(calls(harness.created, 'globalCompositeOperation'))
      .toContainEqual(expect.objectContaining({ args: ['destination-in'] }));
    expectCoverageReadsStayInsidePieces(result, harness.created);
    expectTemporaryCanvasesReleased(result.canvas, harness.created);
  });

  it('applies one model output transform to the final canvas and reports transformed bounds', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.patternOutputTransform = { rotation: 180, mirrorX: true };
    layout.pieceGroups.push(createGroup('side', '侧片', 2, 'side-mesh'));

    const result = await createUvPatternPieces(createInput(harness, {
      uvLayout: layout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
        createRectMesh('side-mesh', 0, 0, 0.25, 0.25),
      ],
    }));

    expect(result.outputTransform).toEqual({ rotation: 180, mirrorX: true });
    expect(result.outputTransform).not.toBe(layout.patternOutputTransform);
    expect(result.pieces[0].outputBounds.y).toBeGreaterThan(result.pieces[2].outputBounds.y);
    expect(result.pieces.every(({ coveragePixels }) => coveragePixels > 0)).toBe(true);

    const outputOperations = result.canvas.context.operations;
    expect(outputOperations.filter(({ method }) => method === 'save')).toHaveLength(1);
    expect(outputOperations.filter(({ method }) => method === 'restore')).toHaveLength(1);
    expect(outputOperations.filter(({ method, args }) => (
      method === 'scale' && args[0] === -1 && args[1] === 1
    ))).toHaveLength(1);
    expect(outputOperations.filter(({ method, args }) => (
      method === 'rotate' && equivalentAngle(args[0], Math.PI)
    ))).toHaveLength(1);
    expectCoverageReadsStayInsidePieces(result, harness.created);
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
    ['indexed', true],
    ['non-indexed', false],
  ])('accepts short UV attributes when the rendered %s span is covered', async (_, indexed) => {
    const harness = installCanvasHarness();
    const createFront = () => createMeshWithPositionCount(
      'front-mesh',
      6,
      [[0, 0], [0.5, 0], [0, 1]],
      indexed ? [0, 1, 2, 3, 4, 5] : null,
    );
    const front = createFront();
    front.geometry.setDrawRange(0, 3);

    const result = await createUvPatternPieces(createInput(harness, {
      meshes: [front, createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }));
    expect(result.pieces[0].mappedTriangles).toBe(1);

    const partiallyCovered = createFront();
    partiallyCovered.geometry.setDrawRange(0, 6);
    await expect(createUvPatternPieces(createInput(harness, {
      meshes: [partiallyCovered, createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }))).rejects.toThrow('裁片');

    const outOfBounds = createFront();
    outOfBounds.geometry.setDrawRange(3, 3);
    await expect(createUvPatternPieces(createInput(harness, {
      meshes: [outOfBounds, createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }))).rejects.toThrow('裁片');
  });

  it.each([
    ['drawRange', () => {
      const mesh = createMesh('front-mesh', [
        [0, 0], [0, 0], [0, 0], [0.5, 0], [0, 1],
      ]);
      mesh.geometry.setDrawRange(2, 3);
      return mesh;
    }],
    ['material group', () => {
      const mesh = createMesh('front-mesh', [[0, 0], [0.5, 0], [0, 1]], [0, 0, 0, 1, 2]);
      mesh.geometry.addGroup(2, 3, 0);
      mesh.material = [new THREE.MeshBasicMaterial()];
      return mesh;
    }],
  ])('starts triangle phases at the actual non-aligned %s start', async (_, createFront) => {
    const harness = installCanvasHarness();
    const result = await createUvPatternPieces(createInput(harness, {
      meshes: [createFront(), createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }));

    expect(result.pieces[0].mappedTriangles).toBe(1);
  });

  it('treats a material array without geometry groups as non-rendered', async () => {
    const harness = installCanvasHarness();
    const front = createIndexedRectMesh('front-mesh');
    front.material = [new THREE.MeshBasicMaterial()];

    await expect(createUvPatternPieces(createInput(harness, {
      meshes: [front, createRectMesh('back-mesh', 0.5, 0, 1, 1)],
    }))).rejects.toThrow('裁片');
  });

  it.each([
    [0, false, { x: 0, y: 0 }],
    [90, false, { x: 4, y: 0 }],
    [180, false, { x: 2, y: 4 }],
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

    if (rotation === 90 || rotation === 270) {
      expect(bounds.width).toBeGreaterThan(bounds.height);
    } else {
      expect(bounds.height).toBeGreaterThan(bounds.width);
    }
    expect(calls(harness.created, 'rotate')
      .some(({ args }) => equivalentAngle(args[0], rotation * Math.PI / 180))).toBe(true);
    expect(calls(harness.created, 'scale')
      .some(({ args }) => args[0] < 0)).toBe(mirrorX);
  });

  it('unions reverse-wound triangle masks across batch boundaries and preserves transparent exterior pixels', async () => {
    expect(uvPatternPieces.drawTriangleMaskBatches).toBeTypeOf('function');
    expect(uvPatternPieces.applyPieceMask).toBeTypeOf('function');
    const atlas = new PixelSurface(4, 4);
    for (let y = 0; y < atlas.height; y += 1) {
      for (let x = 0; x < atlas.width; x += 1) setPixel(atlas, x, y, RED);
    }
    const triangle = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }];
    const triangles = Array.from({ length: 128 }, (_, index) => (
      index % 2 === 0 ? triangle : [...triangle].reverse()
    )).concat([[{ x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]]);

    for (const orderedTriangles of [triangles, [...triangles].reverse()]) {
      const mask = new PixelSurface(4, 4);
      const output = new PixelSurface(4, 4);
      const maskContext = new ExtractionPixelContext(mask);
      const yieldControl = vi.fn(() => Promise.resolve());

      await uvPatternPieces.drawTriangleMaskBatches({
        context: maskContext,
        sourceBounds: { x: 0, y: 0, width: 4, height: 4 },
        triangles: orderedTriangles,
        yieldControl,
      });
      uvPatternPieces.applyPieceMask({
        context: new ExtractionPixelContext(output),
        atlasCanvas: atlas,
        maskCanvas: mask,
        sourceBounds: { x: 0, y: 0, width: 4, height: 4 },
      });

      expect(yieldControl).toHaveBeenCalledTimes(2);
      expect(maskContext.fillCount).toBe(1);
      expect(getPixel(output, 0, 0)).toEqual(RED);
      expect(getPixel(output, 3, 3)).toEqual(RED);
    }
  });

  it.each([
    [0, false, [RED, GREEN, BLUE, YELLOW]],
    [90, false, [BLUE, RED, YELLOW, GREEN]],
    [180, false, [YELLOW, BLUE, GREEN, RED]],
    [270, false, [GREEN, YELLOW, RED, BLUE]],
    [0, true, [GREEN, RED, YELLOW, BLUE]],
    [90, true, [RED, BLUE, GREEN, YELLOW]],
    [180, true, [BLUE, YELLOW, RED, GREEN]],
    [270, true, [YELLOW, GREEN, BLUE, RED]],
  ])('executes rotation %i and mirrorX=%s against concrete corner pixels', (
    rotation,
    mirrorX,
    expectedCorners,
  ) => {
    expect(uvPatternPieces.drawOrientedPiece).toBeTypeOf('function');
    const source = createAsymmetricOrientationSource();
    const width = rotation === 90 || rotation === 270 ? 4 : 2;
    const height = rotation === 90 || rotation === 270 ? 2 : 4;
    const output = new PixelSurface(width, height);

    uvPatternPieces.drawOrientedPiece(
      new OrientationPixelContext(output),
      source,
      { width: 2, height: 4 },
      { rotation, mirrorX },
    );

    expect(readCornerPixels(output)).toEqual(expectedCorners);
  });

  it('counts alpha coverage from a real Uint8ClampedArray region and yields while scanning', async () => {
    expect(uvPatternPieces.countCoveragePixels).toBeTypeOf('function');
    expect(uvPatternPieces.scanCoveragePixels).toBeTypeOf('function');
    const surface = new PixelSurface(3, 2);
    setPixel(surface, 0, 0, RED);
    setPixel(surface, 2, 0, GREEN);
    setPixel(surface, 1, 1, BLUE);
    const context = new ExtractionPixelContext(surface);
    const imageData = context.getImageData(0, 0, 3, 2);
    const yieldControl = vi.fn(() => Promise.resolve());

    expect(uvPatternPieces.countCoveragePixels(imageData)).toBe(3);
    await expect(uvPatternPieces.scanCoveragePixels(
      context,
      { x: 0, y: 0, width: 3, height: 2 },
      yieldControl,
    )).resolves.toBe(3);
    expect(yieldControl).toHaveBeenCalledTimes(1);
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
    expect(harness.created[0]).toMatchObject({ width: 0, height: 0 });
  });

  it('releases the output canvas and preserves a synchronous toBlob rejection', async () => {
    const rejection = new Error('pieces toBlob failed');
    const harness = installCanvasHarness({ toBlobError: rejection });

    await expect(createUvPatternPieces(createInput(harness))).rejects.toBe(rejection);
    expect(harness.created.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it('renders only the first duplicateGroup while preserving independent front/back pieces', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups[0].duplicateGroup = 'body-copy';
    layout.pieceGroups.push({
      ...createGroup('front-inner', '正片内层', 2, 'front-inner-mesh'),
      duplicateGroup: 'body-copy',
    });

    const result = await createUvPatternPieces(createInput(harness, {
      uvLayout: layout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
        createRectMesh('front-inner-mesh', 0, 0, 0.5, 1),
      ],
    }));

    expect(result.pieces.map(({ id }) => id)).toEqual(['front', 'back']);
    expect(result.pieces[0]).toMatchObject({ id: 'front', aliases: ['front-inner'] });
    expect(calls(harness.created, 'drawImage').filter(({ args }) => args[0] === harness.atlas)).toHaveLength(2);
  });

  it('rejects a duplicateGroup that would merge front and back', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups.forEach((group) => { group.duplicateGroup = 'body-copy'; });

    await expect(createUvPatternPieces(createInput(harness, { uvLayout: layout })))
      .rejects.toThrow('正片和背片');
  });

  it.each([
    ['空字符串', ''],
    ['空白字符串', '   '],
    ['对象', {}],
    ['BigInt', 1n],
  ])('rejects non-JSON-safe duplicateGroup values: %s', async (_, duplicateGroup) => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups[0].duplicateGroup = duplicateGroup;

    await expect(createUvPatternPieces(createInput(harness, { uvLayout: layout })))
      .rejects.toThrow('配置');
  });

  it('normalizes duplicateGroup keys and keeps the lowest order when input is reversed', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups.push(
      { ...createGroup('side', 'side', 2, 'side-mesh'), duplicateGroup: ' body-copy ' },
      { ...createGroup('side-copy', 'side copy', 3, 'side-copy-mesh'), duplicateGroup: 'body-copy' },
    );
    layout.pieceGroups.reverse();

    const result = await createUvPatternPieces(createInput(harness, {
      uvLayout: layout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.25, 1),
        createRectMesh('back-mesh', 0.25, 0, 0.5, 1),
        createRectMesh('side-mesh', 0.5, 0, 0.75, 1),
        createRectMesh('side-copy-mesh', 0.75, 0, 1, 1),
      ],
    }));

    expect(result.pieces).toHaveLength(3);
    expect(result.pieces[2]).toMatchObject({
      id: 'side',
      duplicateGroup: 'body-copy',
      aliases: ['side-copy'],
    });
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
    expect(calls(harness.created, 'drawImage').filter(({ args }) => args[0] === harness.atlas))
      .toHaveLength(2);
  });

  it('streams 150000 triangles without spread overflow and yields every bounded batch', async () => {
    expect(uvPatternPieces.collectGroupTriangles).toBeTypeOf('function');
    const triangleCount = 150_000;
    const yieldControl = vi.fn(() => Promise.resolve());
    const startedAt = performance.now();

    const extracted = await uvPatternPieces.collectGroupTriangles(
      { id: 'front', meshes: [createLightweightRepeatedTriangleMesh('front-mesh', triangleCount)] },
      64,
      yieldControl,
    );

    expect(extracted.triangles).toHaveLength(triangleCount);
    expect(extracted.sourceBounds).toEqual({ x: 0, y: 0, width: 32, height: 64 });
    expect(yieldControl.mock.calls.length).toBeGreaterThanOrEqual(Math.ceil(triangleCount / 128));
    expect(performance.now() - startedAt).toBeLessThan(20_000);
  }, 30_000);

  it('yields before parsing triangles and before allocating any canvas', async () => {
    const harness = installCanvasHarness();
    const front = createRectMesh('front-mesh', 0, 0, 0.5, 1);
    const getX = vi.spyOn(front.geometry.getAttribute('uv'), 'getX');
    let firstYield = true;
    const yieldControl = vi.fn(() => {
      if (firstYield) {
        expect(getX).not.toHaveBeenCalled();
        expect(harness.created).toHaveLength(0);
        firstYield = false;
      }
      return Promise.resolve();
    });

    await createUvPatternPieces(createInput(harness, {
      meshes: [front, createRectMesh('back-mesh', 0.5, 0, 1, 1)],
      yieldControl,
    }));
    expect(firstYield).toBe(false);
  });

  it('keeps at most three temporary canvases alive while streaming many pieces', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    const meshes = [
      createRectMesh('front-mesh', 0, 0, 0.2, 1),
      createRectMesh('back-mesh', 0.2, 0, 0.4, 1),
    ];
    for (let index = 2; index < 7; index += 1) {
      const id = `piece-${index}`;
      const meshName = `${id}-mesh`;
      layout.pieceGroups.push(createGroup(id, id, index, meshName));
      meshes.push(createRectMesh(meshName, index / 10, 0, (index + 1) / 10, 0.5));
    }

    await createUvPatternPieces(createInput(harness, { uvLayout: layout, meshes }));

    expect(harness.tracker.maxActiveTemporaryCanvases).toBeLessThanOrEqual(3);
    expectTemporaryCanvasesReleased(harness.created[0], harness.created);
  });

  it('releases the current piece canvases when yieldControl rejects', async () => {
    const harness = installCanvasHarness();
    let callsCount = 0;
    const rejection = new Error('stop yielding');
    const yieldControl = () => {
      callsCount += 1;
      return callsCount === 5 ? Promise.reject(rejection) : Promise.resolve();
    };

    await expect(createUvPatternPieces(createInput(harness, { yieldControl }))).rejects.toBe(rejection);
    if (harness.created.length > 0) {
      expectTemporaryCanvasesReleased(harness.created[0], harness.created);
      expect(harness.created[0]).toMatchObject({ width: 0, height: 0 });
    }
  });

  it('keeps source atlasSize=64 separate from 4096 output coordinates', async () => {
    const harness = installCanvasHarness();
    const result = await createUvPatternPieces(createInput(harness));

    expect(result.pieces.every(({ sourceBounds }) => sourceBounds.x + sourceBounds.width <= 64)).toBe(true);
    expect(result.pieces.some(({ outputBounds }) => outputBounds.width > 64)).toBe(true);
    expect(result).toMatchObject({ width: 4096, height: 4096 });
  });

  it.each([
    ['canvas尺寸不一致', { width: 2, height: 2, atlasSize: 4 }],
    ['atlasSize非整数', { width: 4, height: 4, atlasSize: 4.5 }],
  ])('rejects invalid source atlas dimensions: %s', async (_, dimensions) => {
    const harness = installCanvasHarness();
    harness.atlas.width = dimensions.width;
    harness.atlas.height = dimensions.height;

    await expect(createUvPatternPieces(createInput(harness, { atlasSize: dimensions.atlasSize })))
      .rejects.toThrow('Atlas');
  });

  it('lays out more than two pieces on a deterministic grid with one uniform scale', async () => {
    const harness = installCanvasHarness();
    const layout = createLayout();
    layout.pieceGroups.push(createGroup('side', '侧片', 2, 'side-mesh'));
    const result = await createUvPatternPieces(createInput(harness, {
      uvLayout: layout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.25, 1),
        createRectMesh('back-mesh', 0.25, 0, 0.75, 0.5),
        createRectMesh('side-mesh', 0.75, 0, 1, 0.25),
      ],
    }));

    expect(result.pieces.map(({ id }) => id)).toEqual(['front', 'back', 'side']);
    const scales = result.pieces.flatMap(({ sourceBounds, outputBounds }) => [
      outputBounds.width / sourceBounds.width,
      outputBounds.height / sourceBounds.height,
    ]);
    expect(new Set(scales)).toEqual(new Set([28]));
    expect(new Set(result.pieces.map(({ scale }) => scale))).toEqual(new Set([28]));
    for (const piece of result.pieces) {
      expect(Math.abs(piece.outputBounds.width - piece.sourceBounds.width * piece.scale))
        .toBeLessThanOrEqual(1);
      expect(Math.abs(piece.outputBounds.height - piece.sourceBounds.height * piece.scale))
        .toBeLessThanOrEqual(1);
    }
    for (const { outputBounds } of result.pieces) {
      expect(outputBounds.x).toBeGreaterThanOrEqual(192);
      expect(outputBounds.y).toBeGreaterThanOrEqual(192);
      expect(outputBounds.x + outputBounds.width).toBeLessThanOrEqual(3904);
      expect(outputBounds.y + outputBounds.height).toBeLessThanOrEqual(3904);
    }
    for (let left = 0; left < result.pieces.length; left += 1) {
      for (let right = left + 1; right < result.pieces.length; right += 1) {
        expect(rectanglesHaveGap(
          result.pieces[left].outputBounds,
          result.pieces[right].outputBounds,
          128,
        )).toBe(true);
      }
    }
  });

  it('creates a deterministic fingerprint that changes with layout transforms', async () => {
    const first = await createFingerprintResult(0);
    const second = await createFingerprintResult(0);
    const rotated = await createFingerprintResult(90);

    expect(first).toEqual(expect.any(String));
    expect(first).toBe(second);
    expect(rotated).not.toBe(first);
  });

  it('changes the layout fingerprint when the model output transform changes', async () => {
    const identity = await createScenarioResult();
    const transformedLayout = createLayout();
    transformedLayout.patternOutputTransform = { rotation: 180, mirrorX: true };
    const transformed = await createScenarioResult({ layout: transformedLayout });

    expect(transformed.layoutFingerprint).not.toBe(identity.layoutFingerprint);
    expect(identity.outputTransform).toEqual({ rotation: 0, mirrorX: false });
    expect(transformed.outputTransform).toEqual({ rotation: 180, mirrorX: true });
  });

  it('fingerprints order, source bounds, output bounds, and aliases from real inputs', async () => {
    const baseline = await createScenarioResult();

    const orderLayout = createLayout();
    orderLayout.pieceGroups[0].order = 1;
    orderLayout.pieceGroups[1].order = 0;
    const reordered = await createScenarioResult({ layout: orderLayout });
    expect(reordered.pieces.map(({ id }) => id)).toEqual(['back', 'front']);
    expect(reordered.layoutFingerprint).not.toBe(baseline.layoutFingerprint);

    const shiftedSource = await createScenarioResult({
      meshes: [
        createRectMesh('front-mesh', 0.25, 0, 0.75, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
      ],
    });
    expect(shiftedSource.pieces[0].sourceBounds).not.toEqual(baseline.pieces[0].sourceBounds);
    expect(shiftedSource.pieces[0].outputBounds).toEqual(baseline.pieces[0].outputBounds);
    expect(shiftedSource.layoutFingerprint).not.toBe(baseline.layoutFingerprint);

    const gridLayout = createLayout();
    gridLayout.pieceGroups.push(createGroup('side', '侧片', 2, 'side-mesh'));
    const changedOutput = await createScenarioResult({
      layout: gridLayout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
        createRectMesh('side-mesh', 0, 0, 0.25, 0.25),
      ],
    });
    expect(changedOutput.pieces[0].outputBounds).not.toEqual(baseline.pieces[0].outputBounds);
    expect(changedOutput.layoutFingerprint).not.toBe(baseline.layoutFingerprint);

    const twoAliasLayout = createLayout();
    twoAliasLayout.pieceGroups[0].duplicateGroup = 'body-copy';
    twoAliasLayout.pieceGroups.push({
      ...createGroup('front-inner', 'front inner', 2, 'front-inner-mesh'),
      duplicateGroup: 'body-copy',
    });
    const twoAliases = await createScenarioResult({
      layout: twoAliasLayout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
        createRectMesh('front-inner-mesh', 0, 0, 0.5, 1),
      ],
    });
    const threeAliasLayout = createLayout();
    threeAliasLayout.pieceGroups[0].duplicateGroup = 'body-copy';
    threeAliasLayout.pieceGroups.push(
      {
        ...createGroup('front-inner', 'front inner', 2, 'front-inner-mesh'),
        duplicateGroup: 'body-copy',
      },
      {
        ...createGroup('front-lining', 'front lining', 3, 'front-lining-mesh'),
        duplicateGroup: 'body-copy',
      },
    );
    const threeAliases = await createScenarioResult({
      layout: threeAliasLayout,
      meshes: [
        createRectMesh('front-mesh', 0, 0, 0.5, 1),
        createRectMesh('back-mesh', 0.5, 0, 1, 1),
        createRectMesh('front-inner-mesh', 0, 0, 0.5, 1),
        createRectMesh('front-lining-mesh', 0, 0, 0.5, 1),
      ],
    });
    expect(twoAliases.pieces[0].aliases).toEqual(['front-inner']);
    expect(threeAliases.pieces[0].aliases).toEqual(['front-inner', 'front-lining']);
    expect(threeAliases.pieces[0].sourceBounds).toEqual(twoAliases.pieces[0].sourceBounds);
    expect(threeAliases.pieces[0].outputBounds).toEqual(twoAliases.pieces[0].outputBounds);
    expect(threeAliases.layoutFingerprint).not.toBe(twoAliases.layoutFingerprint);
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

async function createScenarioResult({
  layout = createLayout(),
  meshes = [
    createRectMesh('front-mesh', 0, 0, 0.5, 1),
    createRectMesh('back-mesh', 0.5, 0, 1, 1),
  ],
} = {}) {
  const harness = installCanvasHarness();
  const result = await createUvPatternPieces(createInput(harness, { uvLayout: layout, meshes }));
  vi.restoreAllMocks();
  return result;
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
  toBlobError = null,
} = {}) {
  const atlas = new RecordingCanvas({ role: 'atlas', coverageAlpha });
  atlas.width = 64;
  atlas.height = 64;
  const created = [];
  const tracker = {
    maxActiveTemporaryCanvases: 0,
    update() {
      const active = created.slice(1)
        .filter((canvas) => canvas.width > 0 && canvas.height > 0)
        .length;
      this.maxActiveTemporaryCanvases = Math.max(this.maxActiveTemporaryCanvases, active);
    },
  };
  const nativeCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
    if (tagName !== 'canvas') return nativeCreateElement(tagName, options);
    const canvas = new RecordingCanvas({
      blob,
      coverageAlpha,
      role: 'generated',
      toBlobError,
      tracker,
    });
    created.push(canvas);
    return canvas;
  });
  return { atlas, created, tracker };
}

class RecordingCanvas {
  constructor({
    blob = new Blob(['png'], { type: 'image/png' }),
    coverageAlpha = 255,
    role,
    toBlobError = null,
    tracker = null,
  } = {}) {
    this._width = 0;
    this._height = 0;
    this.role = role;
    this.toBlobError = toBlobError;
    this.blob = blob;
    this.tracker = tracker;
    this.context = new RecordingContext(this, coverageAlpha);
    this.operations = [];
  }

  get width() { return this._width; }
  set width(value) { this._width = value; this.tracker?.update(); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.tracker?.update(); }

  getContext(type) {
    this.operations.push({ method: 'getContext', args: [type] });
    return type === '2d' ? this.context : null;
  }

  toBlob(callback, type) {
    this.operations.push({ method: 'toBlob', args: [type] });
    if (this.toBlobError) throw this.toBlobError;
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
  fill(...args) { this.record('fill', args); }
  drawImage(...args) { this.record('drawImage', args); }
  translate(...args) { this.record('translate', args); }
  rotate(...args) { this.record('rotate', args); }
  scale(...args) { this.record('scale', args); }
  transform(...args) { this.record('transform', args); }
  setTransform(...args) { this.record('setTransform', args); }
  clearRect(...args) { this.record('clearRect', args); }
  set globalCompositeOperation(value) { this.record('globalCompositeOperation', [value]); }

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

const TRANSPARENT = [0, 0, 0, 0];
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const YELLOW = [255, 255, 0, 255];

class PixelSurface {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
}

class ExtractionPixelContext {
  constructor(surface) {
    this.surface = surface;
    this.pathTriangles = [];
    this.currentTriangle = null;
    this.globalCompositeOperation = 'source-over';
    this.fillStyle = '#000000';
    this.fillCount = 0;
  }

  beginPath() { this.pathTriangles = []; this.currentTriangle = null; }
  moveTo(x, y) { this.currentTriangle = [{ x, y }]; }
  lineTo(x, y) { this.currentTriangle.push({ x, y }); }
  closePath() {
    if (this.currentTriangle.length !== 3) throw new Error('像素提取测试仅支持三角形路径。');
    this.pathTriangles.push(this.currentTriangle);
    this.currentTriangle = null;
  }

  fill() {
    this.fillCount += 1;
    forEachPixel(0, 0, this.surface.width, this.surface.height, (pixelX, pixelY) => {
      const center = { x: pixelX + 0.5, y: pixelY + 0.5 };
      const winding = this.pathTriangles.reduce((sum, triangle) => (
        pointInsideTriangle(center, triangle) ? sum + Math.sign(signedTriangleArea(triangle)) : sum
      ), 0);
      if (winding !== 0) {
        setPixel(this.surface, pixelX, pixelY, [255, 255, 255, 255]);
      }
    });
  }

  clearRect(x, y, width, height) {
    forEachPixel(x, y, width, height, (pixelX, pixelY) => {
      setPixel(this.surface, pixelX, pixelY, TRANSPARENT);
    });
  }

  drawImage(source, ...args) {
    if (args.length === 2) {
      const [x, y] = args;
      forEachPixel(x, y, source.width, source.height, (pixelX, pixelY) => {
        const sourcePixel = getPixel(source, pixelX - x, pixelY - y);
        if (this.globalCompositeOperation === 'destination-in') {
          if (sourcePixel[3] === 0) setPixel(this.surface, pixelX, pixelY, TRANSPARENT);
          return;
        }
        setPixel(this.surface, pixelX, pixelY, sourcePixel);
      });
      return;
    }
    const [sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height] = args;
    forEachPixel(x, y, width, height, (pixelX, pixelY) => {
      const sampledX = Math.floor(sourceX + ((pixelX - x + 0.5) / width) * sourceWidth);
      const sampledY = Math.floor(sourceY + ((pixelY - y + 0.5) / height) * sourceHeight);
      setPixel(this.surface, pixelX, pixelY, getPixel(source, sampledX, sampledY));
    });
  }

  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    let targetIndex = 0;
    forEachPixel(x, y, width, height, (pixelX, pixelY) => {
      data.set(getPixel(this.surface, pixelX, pixelY), targetIndex);
      targetIndex += 4;
    });
    return { data, width, height };
  }
}

class OrientationPixelContext {
  constructor(surface) {
    this.surface = surface;
    this.operations = [];
    this.savedOperations = [];
  }

  save() { this.savedOperations.push([...this.operations]); }
  restore() { this.operations = this.savedOperations.pop() ?? []; }
  translate(x, y) { this.operations.push({ type: 'translate', x, y }); }
  scale(x, y) {
    if (![-1, 1].includes(x) || y !== 1) throw new Error('方向测试仅支持水平镜像。');
    this.operations.push({ type: 'scale', x, y });
  }
  rotate(angle) {
    const quarter = Math.round(angle / (Math.PI / 2)) % 4;
    if (!equivalentAngle(angle, quarter * Math.PI / 2)) {
      throw new Error('方向测试仅支持 0/90/180/270 度。');
    }
    this.operations.push({ type: 'rotate', quarter });
  }

  drawImage(source, x, y) {
    if (x !== 0 || y !== 0) throw new Error('方向测试只支持原点 drawImage。');
    for (let sourceY = 0; sourceY < source.height; sourceY += 1) {
      for (let sourceX = 0; sourceX < source.width; sourceX += 1) {
        const color = getPixel(source, sourceX, sourceY);
        if (color[3] === 0) continue;
        const target = applyDiscreteOperations(
          { x: sourceX + 0.5, y: sourceY + 0.5 },
          this.operations,
        );
        setPixel(this.surface, Math.floor(target.x), Math.floor(target.y), color);
      }
    }
  }
}

function applyDiscreteOperations(point, operations) {
  return [...operations].reverse().reduce((current, operation) => {
    if (operation.type === 'translate') {
      return { x: current.x + operation.x, y: current.y + operation.y };
    }
    if (operation.type === 'scale') {
      return { x: current.x * operation.x, y: current.y * operation.y };
    }
    switch ((operation.quarter + 4) % 4) {
      case 1: return { x: -current.y, y: current.x };
      case 2: return { x: -current.x, y: -current.y };
      case 3: return { x: current.y, y: -current.x };
      default: return current;
    }
  }, point);
}

function pointInsideTriangle(point, [first, second, third]) {
  const cross = (left, right, target) => (
    (target.x - right.x) * (left.y - right.y)
    - (left.x - right.x) * (target.y - right.y)
  );
  const firstSign = cross(point, first, second);
  const secondSign = cross(point, second, third);
  const thirdSign = cross(point, third, first);
  return !(
    (firstSign < 0 || secondSign < 0 || thirdSign < 0)
    && (firstSign > 0 || secondSign > 0 || thirdSign > 0)
  );
}

function signedTriangleArea([first, second, third]) {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

function createAsymmetricOrientationSource() {
  const surface = new PixelSurface(2, 4);
  setPixel(surface, 0, 0, RED);
  setPixel(surface, 1, 0, GREEN);
  setPixel(surface, 0, 3, BLUE);
  setPixel(surface, 1, 3, YELLOW);
  return surface;
}

function readCornerPixels(surface) {
  return [
    getPixel(surface, 0, 0),
    getPixel(surface, surface.width - 1, 0),
    getPixel(surface, 0, surface.height - 1),
    getPixel(surface, surface.width - 1, surface.height - 1),
  ];
}

function forEachPixel(x, y, width, height, callback) {
  for (let pixelY = y; pixelY < y + height; pixelY += 1) {
    for (let pixelX = x; pixelX < x + width; pixelX += 1) callback(pixelX, pixelY);
  }
}

function setPixel(surface, x, y, color) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  surface.pixels.set(color, (y * surface.width + x) * 4);
}

function getPixel(surface, x, y) {
  const start = (y * surface.width + x) * 4;
  return [...surface.pixels.slice(start, start + 4)];
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

function rectanglesHaveGap(left, right, gap) {
  return left.x + left.width + gap <= right.x
    || right.x + right.width + gap <= left.x
    || left.y + left.height + gap <= right.y
    || right.y + right.height + gap <= left.y;
}

function createMesh(name, uvs, indices = null) {
  return createMeshWithPositionCount(name, uvs.length, uvs, indices);
}

function createMeshWithPositionCount(name, positionCount, uvs, indices = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    Array.from({ length: positionCount }, () => [0, 0, 0]).flat(),
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

function createLightweightRepeatedTriangleMesh(name, triangleCount) {
  const count = triangleCount * 3;
  const position = {
    count,
    itemSize: 3,
    normalized: false,
    version: 0,
    getX: () => 0,
    getY: () => 0,
    getZ: () => 0,
  };
  const uv = {
    count,
    itemSize: 2,
    normalized: false,
    version: 0,
    getX: (index) => [0, 0.5, 0][index % 3],
    getY: (index) => [0, 0, 1][index % 3],
  };
  const geometry = {
    attributes: { position, uv },
    drawRange: { start: 0, count: Infinity },
    groups: [],
    getAttribute(attributeName) { return this.attributes[attributeName]; },
    getIndex() { return null; },
  };
  return { name, geometry, material: { visible: true } };
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
