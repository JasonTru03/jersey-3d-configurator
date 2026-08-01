import { describe, expect, it, vi } from 'vitest';
import { jerseyProduct } from '../config/productDefinitions.js';
import { selectedOptions } from '../config/selectors.js';
import { parseDesignDocument } from './designDocument.js';
import { createDesignFingerprint } from './productionFingerprint.js';
import { createProductionPackage } from './productionPackage.js';

const ZIP_NAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
];

describe('production package', () => {
  it('creates and verifies the exact deterministic seven-file package', async () => {
    const state = structuredClone(jerseyProduct.defaultState);
    const selected = selectedOptions(jerseyProduct, state);
    const rendered = createRenderedArtifacts();
    const artifactProvider = vi.fn().mockResolvedValue(rendered);
    const createReferencePdf = vi.fn().mockResolvedValue({
      blob: new Blob(['pdf'], { type: 'application/pdf' }),
      pageCount: 2,
      pageSize: { widthMm: 297, heightMm: 210 },
    });

    const result = await createProductionPackage({
      artifactProvider,
      generatedAt: '2026-07-31T08:00:00.000Z',
      product: jerseyProduct,
      selected,
      state,
      variantId: '48039101923479',
    }, { createReferencePdf });

    expect(result.filename).toMatch(/^fn8788-jersey-design-[0-9a-f]{8}\.zip$/);
    expect(result.files.map((file) => file.filename)).toEqual(ZIP_NAMES);
    expect(result.manifest).toMatchObject({
      designFingerprint: result.fingerprint,
      productId: 'fn8788-jersey',
      variantId: '48039101923479',
      size: 'm',
      model: { id: 'chelsea-jersey', version: '1' },
      uvExportVersion: '1',
      atlas: { width: 4096, height: 4096, colorSpace: 'sRGB' },
      patternPieces: {
        width: 4096,
        height: 4096,
        layoutFingerprint: 'uv-pieces-v1-12ab34cd',
        pieces: rendered.pieces.pieces,
      },
    });
    expect(result.manifest.files).toHaveLength(6);
    const providerRequest = artifactProvider.mock.calls[0][0];
    expect(providerRequest.model).toEqual(jerseyProduct.model);
    expect(providerRequest.model).not.toBe(jerseyProduct.model);
    expect(providerRequest.stateSnapshot).toEqual(state);
    expect(providerRequest.stateSnapshot).not.toBe(state);
    expect(createReferencePdf).toHaveBeenCalledWith(expect.objectContaining({
      atlasSize: 4096,
      designFingerprint: result.fingerprint,
      pieces: rendered.pieces.canvas,
      piecesSize: { width: 4096, height: 4096 },
      previewBack: rendered.previews.back.canvas,
      previewFront: rendered.previews.front.canvas,
      sizeLabel: 'M',
      templateLabel: '纯色',
    }));
    expect(createReferencePdf.mock.calls[0][0]).not.toHaveProperty('atlas');
    expect(rendered.atlas.canvas.width).toBe(0);
    expect(rendered.pieces.canvas.width).toBe(0);
    expect(rendered.previews.front.canvas.width).toBe(0);

    const designFile = result.files.find((file) => file.filename === 'design.json');
    const document = JSON.parse(await designFile.blob.text());
    const reopened = parseDesignDocument(JSON.stringify(document), {
      colorways: jerseyProduct.options.colorway,
      defaultState: jerseyProduct.defaultState,
      expectedProductId: jerseyProduct.id,
    });
    expect(reopened).toEqual(expect.objectContaining({
      productId: 'fn8788-jersey',
      layout: 'm',
    }));
    await expect(createDesignFingerprint({
      model: jerseyProduct.model,
      productId: jerseyProduct.id,
      size: reopened.layout,
      state: reopened,
      variantId: document.variantId,
    })).resolves.toBe(result.fingerprint);
  });

  it('rejects an atlas that does not match the configured 4096 contract', async () => {
    const rendered = createRenderedArtifacts();
    rendered.atlas.width = 2048;
    rendered.atlas.height = 2048;

    await expect(createProductionPackage({
      artifactProvider: vi.fn().mockResolvedValue(rendered),
      product: jerseyProduct,
      selected: selectedOptions(jerseyProduct, jerseyProduct.defaultState),
      state: jerseyProduct.defaultState,
    }, {
      createReferencePdf: vi.fn(),
    })).rejects.toThrow('UV Atlas 必须是 4096×4096 PNG。');
  });

  it('rejects missing pattern pieces and releases the renderer canvases', async () => {
    const rendered = createRenderedArtifacts();
    delete rendered.pieces;

    await expect(createProductionPackage({
      artifactProvider: vi.fn().mockResolvedValue(rendered),
      product: jerseyProduct,
      selected: selectedOptions(jerseyProduct, jerseyProduct.defaultState),
      state: jerseyProduct.defaultState,
    }, {
      createReferencePdf: vi.fn(),
    })).rejects.toThrow('UV 裁片排版图必须是 4096×4096 PNG，并包含非空裁片清单。');
    expect(rendered.atlas.canvas.width).toBe(0);
    expect(rendered.previews.front.canvas.width).toBe(0);
    expect(rendered.previews.back.canvas.width).toBe(0);
  });

  it('rejects pattern pieces that do not match the configured 4096 contract', async () => {
    const rendered = createRenderedArtifacts();
    rendered.pieces.width = 2048;

    await expect(createProductionPackage({
      artifactProvider: vi.fn().mockResolvedValue(rendered),
      product: jerseyProduct,
      selected: selectedOptions(jerseyProduct, jerseyProduct.defaultState),
      state: jerseyProduct.defaultState,
    }, {
      createReferencePdf: vi.fn(),
    })).rejects.toThrow('UV 裁片排版图必须是 4096×4096 PNG，并包含非空裁片清单。');
    expect(rendered.pieces.canvas.width).toBe(0);
  });

  it('does not create a ZIP after renderer or PDF failure', async () => {
    const createBundle = vi.fn();
    await expect(createProductionPackage({
      artifactProvider: vi.fn().mockRejectedValue(new Error('图层无法映射')),
      product: jerseyProduct,
      selected: selectedOptions(jerseyProduct, jerseyProduct.defaultState),
      state: jerseyProduct.defaultState,
    }, {
      createBundle,
      createReferencePdf: vi.fn(),
    })).rejects.toThrow('图层无法映射');
    expect(createBundle).not.toHaveBeenCalled();

    const rendered = createRenderedArtifacts();
    await expect(createProductionPackage({
      artifactProvider: vi.fn().mockResolvedValue(rendered),
      product: jerseyProduct,
      selected: selectedOptions(jerseyProduct, jerseyProduct.defaultState),
      state: jerseyProduct.defaultState,
    }, {
      createBundle,
      createReferencePdf: vi.fn().mockRejectedValue(new Error('PDF failed')),
    })).rejects.toThrow('PDF failed');
    expect(createBundle).not.toHaveBeenCalled();
    expect(rendered.atlas.canvas.width).toBe(0);
    expect(rendered.pieces.canvas.width).toBe(0);
    expect(rendered.previews.front.canvas.width).toBe(0);
    expect(rendered.previews.back.canvas.width).toBe(0);
  });
});

function createRenderedArtifacts() {
  return {
    atlas: {
      blob: new Blob(['atlas'], { type: 'image/png' }),
      canvas: { id: 'atlas', width: 4096, height: 4096 },
      colorSpace: 'sRGB',
      height: 4096,
      width: 4096,
    },
    legacyBakeMetadata: null,
    pieces: {
      blob: new Blob(['pieces'], { type: 'image/png' }),
      canvas: { id: 'pieces', width: 4096, height: 4096 },
      height: 4096,
      layoutFingerprint: 'uv-pieces-v1-12ab34cd',
      pieces: [createPieceMetadata()],
      width: 4096,
    },
    previews: {
      front: {
        blob: new Blob(['front'], { type: 'image/png' }),
        canvas: { id: 'front', width: 1600, height: 1600 },
        height: 1600,
        width: 1600,
      },
      back: {
        blob: new Blob(['back'], { type: 'image/png' }),
        canvas: { id: 'back', width: 1600, height: 1600 },
        height: 1600,
        width: 1600,
      },
    },
  };
}

function createPieceMetadata() {
  return {
    aliases: [],
    coveragePixels: 840000,
    duplicateGroup: null,
    id: 'front',
    islandRefs: [{ meshName: 'Cloth_mesh_7' }],
    label: '正片',
    mappedTriangles: 128,
    mirrorX: false,
    order: 0,
    outputBounds: { x: 192, y: 192, width: 1600, height: 3600 },
    rotation: 0,
    scale: 1.5,
    sourceBounds: { x: 100, y: 200, width: 1067, height: 2400 },
    sourceMeshes: ['Cloth_mesh_7'],
    zone: 'front',
  };
}
