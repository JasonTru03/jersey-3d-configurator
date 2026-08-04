import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import {
  DESIGN_DOCUMENT_FORMAT,
  DESIGN_DOCUMENT_VERSION,
  createDesignDocument,
} from '../../src/features/configurator/designs/designDocument.js';
import { createDesignFingerprint } from '../../src/features/configurator/designs/productionFingerprint.js';
import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  createProductionManifest,
} from '../../src/features/configurator/designs/productionManifest.js';
import {
  validateAndRebuildUploadedProductionPackage,
  validateUploadedProductionPackage,
} from './productionPackageValidator.js';

const SHOP = 'testcsj.myshopify.com';
const PRODUCT_ID = jerseyProduct.id;
const VARIANT_ID = '48039101923479';
const MIME_TYPES = Object.freeze({
  'design.json': 'application/json',
  'uv-atlas.png': 'image/png',
  'uv-pattern-pieces.png': 'image/png',
  'uv-reference.pdf': 'application/pdf',
  'preview-front.png': 'image/png',
  'preview-back.png': 'image/png',
  'manifest.json': 'application/json',
});
const FILE_NAMES = Object.freeze(Object.keys(MIME_TYPES));
const MEBIBYTE = 1024 * 1024;
const FILE_LIMITS = Object.freeze({
  'design.json': 8 * MEBIBYTE,
  'uv-atlas.png': 16 * MEBIBYTE,
  'uv-pattern-pieces.png': 16 * MEBIBYTE,
  'uv-reference.pdf': 8 * MEBIBYTE,
  'preview-front.png': 8 * MEBIBYTE,
  'preview-back.png': 8 * MEBIBYTE,
  'manifest.json': MEBIBYTE,
});

let validFiles;
let originalBlobStream;

beforeAll(async () => {
  originalBlobStream = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  if (!originalBlobStream) installBlobStreamPolyfill();
  validFiles = await createValidFiles();
});

afterAll(() => {
  if (originalBlobStream) Object.defineProperty(Blob.prototype, 'stream', originalBlobStream);
  else delete Blob.prototype.stream;
});

describe('validateUploadedProductionPackage', () => {
  it('shares the exact browser and Worker file contract', () => {
    expect(PRODUCTION_PACKAGE_FILE_CONTRACT).toEqual(FILE_NAMES.map((filename) => ({
      filename,
      maxBytes: FILE_LIMITS[filename],
      mediaType: MIME_TYPES[filename],
    })));
    expect(MAX_PRODUCTION_PACKAGE_BYTES).toBe(32 * MEBIBYTE);
    expect(DESIGN_DOCUMENT_FORMAT).toBe('jersey-design');
  });

  it('returns only frozen normalized metadata and verified seven files', async () => {
    const result = await validateUploadedProductionPackage({
      expectedShop: SHOP,
      files: cloneFiles(validFiles),
    });

    expect(result).toEqual({
      designFingerprint: expect.stringMatching(/^[a-f0-9]{8}$/u),
      files: expect.any(Array),
      modelId: jerseyProduct.model.id,
      modelVersion: jerseyProduct.model.version,
      productId: PRODUCT_ID,
      size: jerseyProduct.defaultState.layout,
      uvExportVersion: '2',
      variantId: VARIANT_ID,
    });
    expect(Object.keys(result)).toEqual([
      'designFingerprint',
      'productId',
      'variantId',
      'size',
      'modelId',
      'modelVersion',
      'uvExportVersion',
      'files',
    ]);
    expect(result.files.map(({ filename }) => filename)).toEqual(FILE_NAMES);
    expect(result.files.every(({ blob, filename }) => (
      blob instanceof Blob && blob.type === MIME_TYPES[filename]
    ))).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.files)).toBe(true);
    expect(result.files.every(Object.isFrozen)).toBe(true);
    expect(result).not.toHaveProperty('expectedShop');
  });

  it.each([
    ['missing', (files) => files.slice(0, -1)],
    ['wrong order', (files) => [files[1], files[0], ...files.slice(2)]],
    ['renamed', (files) => files.map((file, index) => (
      index === 1 ? { ...file, filename: 'renamed.png' } : file
    ))],
    ['extra', (files) => [...files, { ...files[0], filename: 'extra.json' }]],
  ])('rejects a %s file list', async (_label, mutate) => {
    await expect(validateUploadedProductionPackage({
      expectedShop: SHOP,
      files: mutate(cloneFiles(validFiles)),
    })).rejects.toThrow('Uploaded production package is invalid.');
  });

  it('rejects top-level and per-file extra fields', async () => {
    await expect(validateUploadedProductionPackage({
      expectedShop: SHOP,
      files: cloneFiles(validFiles),
      uploadedZip: new Blob(['untrusted']),
    })).rejects.toThrow('Uploaded production package is invalid.');

    const files = cloneFiles(validFiles);
    files[0] = { ...files[0], clientMetadata: 'untrusted' };
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow('Uploaded production package is invalid.');
  });

  it.each([
    undefined,
    '',
    'TESTCSJ.myshopify.com',
    'testcsj.myshopify.com.attacker.example',
    'testcsj.myshopify.com/',
  ])('rejects malformed expected shop %j', async (expectedShop) => {
    await expect(validateUploadedProductionPackage({
      expectedShop,
      files: cloneFiles(validFiles),
    })).rejects.toThrow('Uploaded production package is invalid.');
  });

  it('does not invoke accessor fields while snapshotting the request', async () => {
    const request = Object.defineProperties({}, {
      expectedShop: { enumerable: true, get: () => { throw new Error('getter ran'); } },
      files: { enumerable: true, value: cloneFiles(validFiles) },
    });

    await expect(validateUploadedProductionPackage(request))
      .rejects.toThrow('Uploaded production package is invalid.');
  });

  it('does not invoke accessor entries while snapshotting the files array', async () => {
    const files = cloneFiles(validFiles);
    Object.defineProperty(files, '0', {
      enumerable: true,
      get() {
        throw new Error('file getter ran');
      },
    });

    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow('Uploaded production package is invalid.');
  });

  it('rejects an empty file', async () => {
    const files = replaceFile(validFiles, 'preview-front.png', new Blob([], { type: 'image/png' }));
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow('Uploaded production package is invalid.');
  });

  it.each(Object.entries(FILE_LIMITS))('accepts %s at its exact byte limit', async (filename, byteLimit) => {
    const files = await resizeValidFile(validFiles, filename, byteLimit);
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .resolves.toMatchObject({ productId: PRODUCT_ID });
  }, 30_000);

  it.each(Object.entries(FILE_LIMITS))('rejects %s at one byte above its limit', async (filename, byteLimit) => {
    const files = replaceFile(
      validFiles,
      filename,
      new Blob([new Uint8Array(byteLimit + 1)], { type: MIME_TYPES[filename] }),
    );
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow('Uploaded production package is invalid.');
  }, 30_000);

  it('accepts an exact 32 MiB aggregate and rejects one additional byte', async () => {
    const sizes = {
      'design.json': 4 * MEBIBYTE,
      'uv-atlas.png': 8 * MEBIBYTE,
      'uv-pattern-pieces.png': 8 * MEBIBYTE,
      'uv-reference.pdf': 4 * MEBIBYTE,
      'preview-front.png': 4 * MEBIBYTE,
      'preview-back.png': 3 * MEBIBYTE,
      'manifest.json': FILE_LIMITS['manifest.json'],
    };
    const exact = await resizeValidFiles(validFiles, sizes);
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files: exact }))
      .resolves.toMatchObject({ productId: PRODUCT_ID });

    const above = cloneFiles(exact);
    above[5] = {
      ...above[5],
      blob: new Blob([above[5].blob, new Uint8Array(1)], { type: above[5].blob.type }),
    };
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files: above }))
      .rejects.toThrow('Uploaded production package is invalid.');
  }, 60_000);

  it.each([
    ['declared MIME', 'preview-front.png', new Blob([pngBytes()], { type: 'application/octet-stream' })],
    ['PNG signature', 'preview-front.png', new Blob(['not-png'], { type: 'image/png' })],
    ['design JSON', 'design.json', new Blob(['{'], { type: 'application/json' })],
    ['manifest JSON', 'manifest.json', new Blob(['{'], { type: 'application/json' })],
  ])('rejects invalid %s before returning metadata', async (_label, filename, blob) => {
    await expect(validateUploadedProductionPackage({
      expectedShop: SHOP,
      files: replaceFile(validFiles, filename, blob),
    })).rejects.toThrow();
  });

  it('rejects non-PDF content after its manifest hash and byte length are refreshed', async () => {
    const replaced = replaceFile(
      validFiles,
      'uv-reference.pdf',
      new Blob(['NOT-A-PDF-DOCUMENT'], { type: 'application/pdf' }),
    );
    const files = await refreshManifest(replaced);

    const error = await validateUploadedProductionPackage({ expectedShop: SHOP, files })
      .then(() => null, (reason) => reason);
    expect(error).toMatchObject({
      code: 'invalid-production-package',
      message: 'Uploaded production package is invalid.',
      name: 'ProductionPackageValidationError',
    });
    expect(error.cause).toMatchObject({
      message: 'Production file uv-reference.pdf has invalid content.',
    });
  });

  it.each([
    ['format', (design) => ({ ...design, format: 'other-design' })],
    ['version', (design) => ({ ...design, version: DESIGN_DOCUMENT_VERSION + 1 })],
    ['state', (design) => ({ ...design, state: null })],
  ])('rejects an invalid design document %s contract', async (_label, mutate) => {
    const files = await replaceJsonAndRefreshManifest(validFiles, 'design.json', mutate);
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow('Uploaded production package is invalid.');
  });

  it.each([1, 2])('rejects legacy design document version %s for production upload', async (version) => {
    const files = await replaceJsonAndRefreshManifest(
      validFiles,
      'design.json',
      (design) => ({ ...design, version }),
    );

    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });

  it.each([
    ['preview-front.png', pngBytes().slice(0, 8)],
    ['preview-back.png', pngBytes().slice(0, 16)],
    ['preview-front.png', pngBytes(1, 1, [73, 68, 65, 84])],
    ['preview-back.png', pngBytes(0, 1)],
    ['preview-front.png', pngBytes(1, 0)],
  ])('rejects structurally invalid preview PNG %s after hashes are refreshed', async (filename, bytes) => {
    const replaced = replaceFile(
      validFiles,
      filename,
      new Blob([bytes], { type: 'image/png' }),
    );
    const files = await refreshManifest(replaced);

    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });

  it.each([
    ['productId', 'line\r\nbreak'],
    ['productId', '../escape'],
    ['productId', `a${'x'.repeat(101)}`],
    ['variantId', '0'],
    ['variantId', '01'],
    ['variantId', 'not-a-shopify-id'],
    ['variantId', '1'.repeat(33)],
    ['size', '   '],
    ['size', '../xl'],
    ['size', `x${'l'.repeat(64)}`],
    ['modelId', 'chelsea\r\njersey'],
    ['modelId', '../chelsea'],
    ['modelId', `m${'x'.repeat(64)}`],
    ['modelVersion', ' ../1'],
    ['modelVersion', `v${'1'.repeat(32)}`],
  ])('rejects unsafe %s metadata %j even with a matching fingerprint', async (field, value) => {
    const files = await replaceProductionIdentity(validFiles, field, value);

    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });

  it('rejects a design layout that does not match the manifest size', async () => {
    const files = await replaceProductionIdentity(validFiles, 'layout', 'xl');

    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });

  it('rejects non-string identifiers at the metadata boundary before fingerprinting', async () => {
    const design = JSON.parse(
      await validFiles.find(({ filename }) => filename === 'design.json').blob.text(),
    );
    const manifest = JSON.parse(
      await validFiles.find(({ filename }) => filename === 'manifest.json').blob.text(),
    );
    design.state.layout = 1;
    manifest.size = 1;
    let files = replaceFile(
      validFiles,
      'design.json',
      new Blob([JSON.stringify(design)], { type: 'application/json' }),
    );
    files = replaceFile(
      files,
      'manifest.json',
      new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    );
    files = await refreshManifest(files);

    const error = await validateUploadedProductionPackage({ expectedShop: SHOP, files })
      .then(() => null, (reason) => reason);
    expect(error.cause).toMatchObject({ message: 'Production design document is invalid.' });
  });

  it('returns one stable public error without leaking attacker-controlled metadata', async () => {
    const attack = 'piece\r\nX-Internal-Path: ../secret';
    const files = await replaceManifest(validFiles, (manifest) => ({
      ...manifest,
      patternPieces: {
        ...manifest.patternPieces,
        pieces: manifest.patternPieces.pieces.map((piece, index) => (
          index ? piece : { ...piece, coveragePixels: 0, id: attack }
        )),
      },
    }));

    const error = await validateUploadedProductionPackage({ expectedShop: SHOP, files })
      .then(() => null, (reason) => reason);
    expect(error).toMatchObject({
      code: 'invalid-production-package',
      message: 'Uploaded production package is invalid.',
      name: 'ProductionPackageValidationError',
    });
    expect(error.message).not.toContain(attack);
    expect(JSON.stringify(error)).not.toContain(attack);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.message).toContain(attack);
  });

  it.each([
    ['product', (manifest) => ({ ...manifest, productId: 'other-product' })],
    ['fingerprint', (manifest) => ({ ...manifest, designFingerprint: 'deadbeef' })],
    ['schema', (manifest) => ({ ...manifest, schemaVersion: 1 })],
    ['UV export version', (manifest) => ({ ...manifest, uvExportVersion: '1' })],
  ])('rejects a mismatched manifest %s', async (_label, mutate) => {
    const files = await replaceManifest(validFiles, mutate);
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });

  it('rejects a different valid Shopify variant as a design/manifest mismatch', async () => {
    const files = await replaceManifest(validFiles, (manifest) => ({
      ...manifest,
      variantId: '48039101923480',
    }));

    const error = await validateUploadedProductionPackage({ expectedShop: SHOP, files })
      .then(() => null, (reason) => reason);
    expect(error).toMatchObject({
      code: 'invalid-production-package',
      message: 'Uploaded production package is invalid.',
      name: 'ProductionPackageValidationError',
    });
    expect(error.cause).toMatchObject({
      message: 'Production design and manifest do not match.',
    });
  });

  it.each([
    ['hash', (manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => (
        index ? file : { ...file, sha256: '0'.repeat(64) }
      )),
    })],
    ['byte length', (manifest) => ({
      ...manifest,
      files: manifest.files.map((file, index) => (
        index ? file : { ...file, byteLength: file.byteLength + 1 }
      )),
    })],
    ['PNG dimensions', (manifest) => ({
      ...manifest,
      atlas: { ...manifest.atlas, width: manifest.atlas.width + 1 },
    })],
  ])('rejects a manifest with a bad artifact %s', async (_label, mutate) => {
    const files = await replaceManifest(validFiles, mutate);
    await expect(validateUploadedProductionPackage({ expectedShop: SHOP, files }))
      .rejects.toThrow();
  });
});

describe('validateAndRebuildUploadedProductionPackage', () => {
  it('atomically validates the upload and rebuilds a lazy R2 stream from the normalized result', async () => {
    const result = await validateAndRebuildUploadedProductionPackage({
      expectedShop: SHOP,
      files: cloneFiles(validFiles),
    });

    expect(Object.keys(result)).toEqual(['validated', 'bundle']);
    expect(result.validated).toMatchObject({
      designFingerprint: expect.stringMatching(/^[a-f0-9]{8}$/u),
      files: expect.any(Array),
      productId: PRODUCT_ID,
    });
    expect(result.bundle).toMatchObject({
      contentLength: expect.any(Number),
      filename: `${PRODUCT_ID}-design-${result.validated.designFingerprint}.zip`,
      mediaType: 'application/zip',
      stream: expect.any(ReadableStream),
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bundle)).toBe(true);

    const zip = new Uint8Array(await new Response(result.bundle.stream).arrayBuffer());
    expect(readCentralNames(zip)).toEqual(FILE_NAMES);
  });

  it.each([
    ['an uploaded ZIP', (request) => ({
      ...request,
      uploadedZip: new Blob(['untrusted'], { type: 'application/zip' }),
    })],
    ['forged metadata', (request) => ({
      ...request,
      designFingerprint: 'deadbeef',
      productId: 'forged-product',
    })],
    ['an arbitrary replacement Blob', (request) => ({
      ...request,
      files: request.files.map((file, index) => (
        index === 4
          ? { ...file, blob: new Blob([pngBytes(2, 2)], { type: 'image/png' }) }
          : file
      )),
    })],
  ])('does not let %s bypass validation and reach ZIP rebuild', async (_label, mutate) => {
    const request = mutate({ expectedShop: SHOP, files: cloneFiles(validFiles) });
    const error = await validateAndRebuildUploadedProductionPackage(request)
      .then(() => null, (reason) => reason);

    expect(error).toMatchObject({
      code: 'invalid-production-package',
      message: 'Uploaded production package is invalid.',
      name: 'ProductionPackageValidationError',
    });
  });
});

async function createValidFiles() {
  const state = structuredClone(jerseyProduct.defaultState);
  const model = structuredClone(jerseyProduct.model);
  const design = createDesignDocument({
    productId: PRODUCT_ID,
    savedAt: '2026-08-04T00:00:00.000Z',
    state,
    variantId: VARIANT_ID,
  });
  const fingerprint = await createDesignFingerprint({
    model,
    productId: PRODUCT_ID,
    size: state.layout,
    state,
    variantId: VARIANT_ID,
  });
  const artifacts = [
    file('design.json', JSON.stringify(design)),
    file('uv-atlas.png', pngBytes()),
    file('uv-pattern-pieces.png', pngBytes()),
    file('uv-reference.pdf', '%PDF-1.7\n%%EOF'),
    file('preview-front.png', pngBytes()),
    file('preview-back.png', pngBytes()),
  ];
  const manifest = await createProductionManifest({
    atlas: { colorSpace: 'sRGB', height: 1, width: 1 },
    designFingerprint: fingerprint,
    files: artifacts.map(({ blob, filename }) => ({
      blob,
      mediaType: MIME_TYPES[filename],
      name: filename,
    })),
    generatedAt: '2026-08-04T00:00:00.000Z',
    model: { id: model.id, version: model.version },
    patternPieces: patternPieces(),
    productId: PRODUCT_ID,
    size: state.layout,
    uvExportVersion: model.uvExportVersion,
    variantId: VARIANT_ID,
  });
  return [...artifacts, file('manifest.json', JSON.stringify(manifest))];
}

function file(filename, body) {
  return { blob: new Blob([body], { type: MIME_TYPES[filename] }), filename };
}

function cloneFiles(files) {
  return files.map(({ blob, filename }) => ({ blob, filename }));
}

function replaceFile(files, filename, blob) {
  return files.map((fileEntry) => (
    fileEntry.filename === filename ? { blob, filename } : { ...fileEntry }
  ));
}

async function resizeValidFile(files, filename, targetSize) {
  const current = files.find((entry) => entry.filename === filename).blob;
  if (targetSize < current.size) throw new Error('Fixture exceeds target size.');
  let resized;
  if (filename.endsWith('.json')) {
    const parsed = JSON.parse(await current.text());
    resized = jsonBlobAtSize(parsed, targetSize);
  } else {
    resized = new Blob([current, new Uint8Array(targetSize - current.size)], {
      type: current.type,
    });
  }
  const replaced = replaceFile(files, filename, resized);
  if (filename === 'manifest.json') return replaced;
  return refreshManifest(replaced);
}

async function resizeValidFiles(files, sizes) {
  let resized = cloneFiles(files);
  for (const filename of FILE_NAMES) {
    if (filename === 'manifest.json') continue;
    const current = resized.find((entry) => entry.filename === filename).blob;
    let blob;
    if (filename === 'design.json') {
      blob = jsonBlobAtSize(JSON.parse(await current.text()), sizes[filename]);
    } else {
      blob = new Blob([current, new Uint8Array(sizes[filename] - current.size)], {
        type: current.type,
      });
    }
    resized = replaceFile(resized, filename, blob);
  }
  resized = await refreshManifest(resized);
  const manifest = resized.find(({ filename }) => filename === 'manifest.json').blob;
  if (sizes['manifest.json'] < manifest.size) throw new Error('Manifest fixture exceeds target size.');
  return replaceFile(
    resized,
    'manifest.json',
    jsonBlobAtSize(JSON.parse(await manifest.text()), sizes['manifest.json']),
  );
}

async function replaceJsonAndRefreshManifest(files, filename, mutate) {
  const original = files.find((entry) => entry.filename === filename).blob;
  const replacement = new Blob([JSON.stringify(mutate(JSON.parse(await original.text())))], {
    type: original.type,
  });
  return refreshManifest(replaceFile(files, filename, replacement));
}

async function replaceManifest(files, mutate) {
  const original = files.find((entry) => entry.filename === 'manifest.json').blob;
  return replaceFile(files, 'manifest.json', new Blob([
    JSON.stringify(mutate(JSON.parse(await original.text()))),
  ], { type: original.type }));
}

async function refreshManifest(files) {
  const original = files.find((entry) => entry.filename === 'manifest.json').blob;
  const manifest = JSON.parse(await original.text());
  const artifacts = files.slice(0, 6).map(({ blob, filename }) => ({
    blob,
    mediaType: MIME_TYPES[filename],
    name: filename,
  }));
  const refreshed = await createProductionManifest({
    ...manifest,
    files: artifacts,
  });
  return replaceFile(files, 'manifest.json', new Blob([JSON.stringify(refreshed)], {
    type: 'application/json',
  }));
}

function jsonBlobAtSize(value, targetSize) {
  const base = { ...value, padding: '' };
  const empty = JSON.stringify(base);
  const paddingLength = targetSize - new TextEncoder().encode(empty).length;
  if (paddingLength < 0) throw new Error('JSON fixture exceeds target size.');
  return new Blob([JSON.stringify({ ...base, padding: 'x'.repeat(paddingLength) })], {
    type: 'application/json',
  });
}

function pngBytes(width = 1, height = 1, chunkType = [73, 72, 68, 82]) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, ...chunkType], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function replaceProductionIdentity(files, field, value) {
  const design = JSON.parse(await files.find(({ filename }) => filename === 'design.json').blob.text());
  const manifest = JSON.parse(await files.find(({ filename }) => filename === 'manifest.json').blob.text());
  if (field === 'productId' || field === 'variantId') {
    design[field] = value;
    manifest[field] = value;
  } else if (field === 'layout') {
    design.state.layout = value;
  } else if (field === 'size') {
    manifest.size = value;
  } else if (field === 'modelId') {
    manifest.model.id = value;
  } else if (field === 'modelVersion') {
    manifest.model.version = value;
  }

  let replaced = replaceFile(
    files,
    'design.json',
    new Blob([JSON.stringify(design)], { type: 'application/json' }),
  );
  const fingerprint = await createDesignFingerprint({
    model: {
      id: manifest.model.id,
      uvExportVersion: manifest.uvExportVersion,
      version: manifest.model.version,
    },
    productId: manifest.productId,
    size: manifest.size,
    state: design.state,
    variantId: manifest.variantId,
  });
  manifest.designFingerprint = fingerprint;
  replaced = replaceFile(
    replaced,
    'manifest.json',
    new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
  );
  replaced = await refreshManifest(replaced);
  const refreshedManifest = JSON.parse(
    await replaced.find(({ filename }) => filename === 'manifest.json').blob.text(),
  );
  refreshedManifest.designFingerprint = fingerprint;
  return replaceFile(
    replaced,
    'manifest.json',
    new Blob([JSON.stringify(refreshedManifest)], { type: 'application/json' }),
  );
}

function patternPieces() {
  return {
    height: 1,
    layoutFingerprint: 'test-layout',
    outputTransform: { mirrorX: false, rotation: 0 },
    pieces: [piece('front', 0), piece('back', 1)],
    width: 1,
  };
}

function piece(id, order) {
  return {
    aliases: [],
    coveragePixels: 1,
    duplicateGroup: null,
    id,
    islandRefs: [{ meshName: `${id}-mesh` }],
    label: id,
    mappedTriangles: 1,
    mirrorX: false,
    order,
    outputBounds: { height: 1, width: 1, x: 0, y: 0 },
    rotation: 0,
    scale: 1,
    sourceBounds: { height: 1, width: 1, x: 0, y: 0 },
    sourceMeshes: [`${id}-mesh`],
    zone: id,
  };
}

function readCentralNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = [];
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    names.push(new TextDecoder().decode(bytes.slice(
      offset + 46,
      offset + 46 + nameLength,
    )));
    offset += 45 + nameLength;
  }
  return names;
}

function installBlobStreamPolyfill() {
  Object.defineProperty(Blob.prototype, 'stream', {
    configurable: true,
    value() {
      const blob = this;
      return new ReadableStream({
        start(controller) {
          const reader = new FileReader();
          reader.addEventListener('load', () => {
            controller.enqueue(new Uint8Array(reader.result));
            controller.close();
          });
          reader.addEventListener('error', () => controller.error(reader.error));
          reader.readAsArrayBuffer(blob);
        },
      });
    },
  });
}
