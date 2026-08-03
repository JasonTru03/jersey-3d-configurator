import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as oracle from './realGarmentPatternTestOracle.js';

describe('real garment pattern test oracle', () => {
  it('keeps the real-model fixture independent from the production triangle collector', () => {
    const fixtureSource = readFileSync(
      resolvePath(process.cwd(), 'src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js'),
      'utf8',
    );

    expect(fixtureSource).not.toContain('renderableUvTriangles.js');
    const oracleSource = readFileSync(
      resolvePath(process.cwd(), 'src/features/configurator/scene/realGarmentPatternTestOracle.js'),
      'utf8',
    );
    expect(oracleSource).not.toContain('renderableUvTriangles.js');
    expect(oracleSource).not.toContain('uvPatternPieces.js');
    expect(fixtureSource).not.toContain(['transform', 'PiecePoint'].join(''));
  });

  it('maps rotation 180 plus mirrorX as a vertical flip with an independent oracle', () => {
    const piece = {
      mirrorX: true,
      outputBounds: { height: 400, width: 300, x: 500, y: 600 },
      rotation: 180,
      sourceBounds: { height: 200, width: 100, x: 10, y: 20 },
    };
    const atlasPoint = { x: 35, y: 70 };

    expect(oracle.mapAtlasPointToPieceOutput(piece, atlasPoint)).toEqual({ x: 575, y: 900 });
    expect(oracle.mapAtlasPointToPieceOutput(piece, atlasPoint, {
      mirrorX: false,
      rotation: 0,
    })).toEqual({ x: 575, y: 700 });
    expect(oracle.mapAtlasPointToPieceOutput(piece, atlasPoint, {
      mirrorX: false,
      rotation: 180,
    })).toEqual({ x: 725, y: 900 });
    expect(oracle.mapAtlasPointToPieceOutput(piece, atlasPoint, {
      mirrorX: true,
      rotation: 0,
    })).toEqual({ x: 725, y: 700 });
  });

  it('keeps the shared real-model loader unfiltered and applies selectors in each caller', () => {
    const helperSource = readSceneSource('realGarmentModelTestHelpers.js');
    const atlasTestSource = readSceneSource('productionAtlasBakerGarmentModels.test.js');
    const patternTestSource = readSceneSource('uvPatternPiecesGarmentModels.test.js');

    expect(helperSource).not.toContain('selectDecorationMeshes');
    expect(atlasTestSource).toContain('selectDecorationMeshes');
    expect(patternTestSource).toContain('selectGarmentPatternMeshes');
  });

  it('collects visible drawn unique non-degenerate UV triangles with an independent iterator', () => {
    const mesh = createMesh({
      drawRange: { count: 15, start: 0 },
      groups: [
        { count: 12, materialIndex: 0, start: 0 },
        { count: 3, materialIndex: 1, start: 12 },
        { count: 3, materialIndex: 2, start: 15 },
      ],
      index: [
        0, 1, 2,
        1, 3, 2,
        2, 1, 0,
        0, 0, 1,
        4, 5, 6,
        6, 7, 8,
      ],
      materials: [
        { visible: true },
        { visible: false },
        { visible: true },
      ],
      positions: [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0,
        2, 0, 0,
        3, 0, 0,
        2, 1, 0,
        3, 1, 0,
        4, 1, 0,
      ],
      uvs: [
        0, 0,
        1, 0,
        0, 1,
        1, 1,
        0.2, 0.2,
        0.4, 0.2,
        0.2, 0.4,
        0.4, 0.4,
        0.6, 0.4,
      ],
    });

    expect(oracle.collectRawRenderableUvTriangles).toBeTypeOf('function');
    expect(oracle.collectRawRenderableUvTriangles(mesh)).toEqual({
      coordinates: [
        0, 0, 1, 0, 0, 1,
        1, 0, 1, 1, 0, 1,
      ],
      triangleCount: 2,
    });
  });

  it('throws when a drawn triangle references a missing UV vertex', () => {
    const mesh = createMesh({
      index: [0, 1, 3],
      positions: [
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
        1, 1, 0,
      ],
      uvs: [0, 0, 1, 0, 0, 1],
    });

    expect(() => oracle.collectRawRenderableUvTriangles(mesh)).toThrow('UV 属性范围外');
  });

  it('pins the supported real-model front/back triangle counts and rejects drift', () => {
    expect(oracle.PINNED_REAL_GARMENT_TRIANGLE_COUNTS).toEqual({
      'chelsea-jersey': { back: 12320, front: 10142 },
      'fn8788-jersey': { back: 7316, front: 6282 },
    });
    expect(oracle.assertPinnedTriangleCounts).toBeTypeOf('function');
    expect(() => oracle.assertPinnedTriangleCounts('chelsea-jersey', {
      back: 12320,
      front: 10142,
    })).not.toThrow();
    expect(() => oracle.assertPinnedTriangleCounts('chelsea-jersey', {
      back: 12320,
      front: 10141,
    })).toThrow('10142');
  });
});

function createMesh({
  drawRange = { count: Infinity, start: 0 },
  groups = [],
  index = null,
  materials = { visible: true },
  positions,
  uvs,
}) {
  const position = createAttribute(positions, 3);
  const uv = createAttribute(uvs, 2);
  const indexAttribute = index ? createAttribute(index, 1) : null;
  return {
    geometry: {
      attributes: { position, uv },
      drawRange,
      groups,
      getAttribute(name) { return this.attributes[name]; },
      getIndex() { return indexAttribute; },
    },
    material: materials,
    name: 'oracle-test-mesh',
  };
}

function readSceneSource(fileName) {
  return readFileSync(
    resolvePath(process.cwd(), `src/features/configurator/scene/${fileName}`),
    'utf8',
  );
}

function createAttribute(values, itemSize) {
  return {
    count: values.length / itemSize,
    getX(index) { return values[index * itemSize]; },
    getY(index) { return values[index * itemSize + 1]; },
    getZ(index) { return values[index * itemSize + 2]; },
    itemSize,
  };
}
