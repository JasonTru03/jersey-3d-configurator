import { createDesignDocument } from './designDocument.js';
import {
  createDesignFingerprint,
} from './productionFingerprint.js';
import {
  createProductionManifest,
  verifyProductionArtifacts,
} from './productionManifest.js';
import { createProductionBundle } from './productionBundle.js';
import { createProductionReferencePdf } from './productionReferencePdf.js';

const ZONE_LABELS = Object.freeze({
  body: '衣身',
  sleeves: '袖子',
  shoulderSide: '肩部与侧面',
  collar: '领口',
  pattern: '图案',
  number: '号码',
});

const TEMPLATE_LABELS = Object.freeze({
  solid: '纯色',
  'vertical-stripes': '竖条纹',
  'horizontal-stripes': '横条纹',
  diagonal: '斜纹',
  gradient: '渐变',
  'color-block': '色块',
});

export async function createProductionPackage({
  artifactProvider,
  generatedAt = new Date().toISOString(),
  product,
  selected,
  state,
  variantId = null,
}, {
  createBundle = createProductionBundle,
  createReferencePdf = createProductionReferencePdf,
} = {}) {
  validateRequest({ artifactProvider, product, selected, state });
  const stateSnapshot = structuredClone(state);
  const modelSnapshot = structuredClone(product.model);
  const size = stateSnapshot.layout;
  const fingerprint = await createDesignFingerprint({
    model: modelSnapshot,
    productId: product.id,
    size,
    state: stateSnapshot,
    variantId,
  });
  const rendered = await artifactProvider({
    model: modelSnapshot,
    stateSnapshot: structuredClone(stateSnapshot),
  });

  try {
    assertImageContract(rendered, modelSnapshot.uvAtlasSize);
    const stateForDocument = withLegacyBakeMetadata(
      stateSnapshot,
      rendered.legacyBakeMetadata,
    );
    const designDocument = createDesignDocument({
      productId: product.id,
      savedAt: generatedAt,
      state: stateForDocument,
      variantId,
    });
    const designBlob = new Blob(
      [JSON.stringify(designDocument, null, 2)],
      { type: 'application/json' },
    );
    const pdf = await createReferencePdf(toPdfInput({
      fingerprint,
      generatedAt,
      product,
      rendered,
      selected,
      size,
    }));
    const artifacts = [
      createFile('design.json', designBlob, 'application/json'),
      createFile('uv-atlas.png', rendered.atlas.blob, 'image/png'),
      createFile('uv-reference.pdf', pdf.blob, 'application/pdf'),
      createFile('preview-front.png', rendered.previews.front.blob, 'image/png'),
      createFile('preview-back.png', rendered.previews.back.blob, 'image/png'),
    ];
    const manifest = await createProductionManifest({
      atlas: {
        colorSpace: 'sRGB',
        height: rendered.atlas.height,
        width: rendered.atlas.width,
      },
      designFingerprint: fingerprint,
      files: artifacts,
      generatedAt,
      model: {
        id: modelSnapshot.id,
        version: modelSnapshot.version,
      },
      productId: product.id,
      size,
      uvExportVersion: modelSnapshot.uvExportVersion,
      variantId,
    });
    await verifyProductionArtifacts(artifacts, manifest);
    const manifestBlob = new Blob(
      [JSON.stringify(manifest, null, 2)],
      { type: 'application/json' },
    );
    const files = [
      ...artifacts,
      createFile('manifest.json', manifestBlob, 'application/json'),
    ].map(({ blob, name }) => ({ blob, filename: name }));
    const bundle = await createBundle({
      files,
      fingerprint,
      productId: product.id,
    });
    if (!(bundle?.blob instanceof Blob) || bundle.blob.size === 0) {
      throw new Error('生产 ZIP 生成失败。');
    }
    return {
      ...bundle,
      files,
      fingerprint,
      legacyBakeMetadata: rendered.legacyBakeMetadata ?? null,
      manifest,
    };
  } finally {
    releaseRenderedCanvases(rendered);
  }
}

function createFile(name, blob, mediaType) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error(`生产文件 "${name}" 为空。`);
  }
  if (blob.type !== mediaType) {
    throw new Error(`生产文件 "${name}" 的媒体类型不正确。`);
  }
  return { blob, mediaType, name };
}

function assertImageContract(rendered, atlasSize) {
  if (
    rendered?.atlas?.width !== atlasSize
    || rendered?.atlas?.height !== atlasSize
    || rendered?.atlas?.blob?.type !== 'image/png'
    || rendered.atlas.blob.size === 0
    || !rendered.atlas.canvas
  ) {
    throw new Error(`UV Atlas 必须是 ${atlasSize}×${atlasSize} PNG。`);
  }
  for (const side of ['front', 'back']) {
    const preview = rendered.previews?.[side];
    if (
      !preview
      || preview.width < 1
      || preview.height < 1
      || preview.blob?.type !== 'image/png'
      || preview.blob.size === 0
      || !preview.canvas
    ) {
      throw new Error('正面或背面预览 PNG 无效。');
    }
  }
}

function toPdfInput({
  fingerprint,
  generatedAt,
  product,
  rendered,
  selected,
  size,
}) {
  return {
    atlas: rendered.atlas.canvas,
    atlasSize: product.model.uvAtlasSize,
    designFingerprint: fingerprint,
    generatedAt,
    model: {
      id: product.model.id,
      version: product.model.version,
      uvExportVersion: product.model.uvExportVersion,
    },
    previewBack: rendered.previews.back.canvas,
    previewFront: rendered.previews.front.canvas,
    productName: product.name,
    sizeLabel: selected.layout?.shortLabel ?? selected.layout?.label ?? size,
    templateLabel: TEMPLATE_LABELS[selected.appearance.template]
      ?? selected.appearance.template,
    zoneColors: Object.entries(selected.appearance.colors).map(([id, value]) => ({
      label: ZONE_LABELS[id] ?? id,
      value,
    })),
  };
}

function withLegacyBakeMetadata(state, bakeMetadata) {
  if (!state.overrides?.bottomPattern?.enabled || !bakeMetadata) return state;
  return {
    ...state,
    overrides: {
      ...state.overrides,
      bottomPattern: {
        ...state.overrides.bottomPattern,
        bakeMetadata: structuredClone(bakeMetadata),
      },
    },
  };
}

function releaseRenderedCanvases(rendered) {
  const canvases = [
    rendered?.atlas?.canvas,
    rendered?.previews?.front?.canvas,
    rendered?.previews?.back?.canvas,
  ];
  canvases.forEach((canvas) => {
    if (!canvas) return;
    canvas.width = 0;
    canvas.height = 0;
  });
}

function validateRequest({ artifactProvider, product, selected, state }) {
  if (typeof artifactProvider !== 'function') {
    throw new Error('3D 模型尚未准备完成，无法生成生产文件。');
  }
  if (
    !product?.id
    || !product.model
    || !selected?.appearance
    || !state
  ) {
    throw new Error('生产文件请求数据不完整。');
  }
}
