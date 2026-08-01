const PAGE_WIDTH = 1684;
const PAGE_HEIGHT = 1191;
const PDF_WIDTH = 841.89;
const PDF_HEIGHT = 595.28;
const WARNING = '此文件为 UV 参考资料，不是工厂 1:1 裁片文件。';

export async function createProductionReferencePdf(
  input,
  { createCanvas = defaultCreateCanvas } = {},
) {
  validateInput(input);
  const first = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const second = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  try {
    drawReferencePage(first, input);
    drawPatternPiecesPage(second, input);
    const firstJpeg = await canvasToJpegBytes(first);
    const secondJpeg = await canvasToJpegBytes(second);
    const pdfBytes = buildRasterPdf(firstJpeg, secondJpeg);
    return {
      blob: new Blob([pdfBytes], { type: 'application/pdf' }),
      pageCount: 2,
      pageSize: { widthMm: 297, heightMm: 210 },
    };
  } finally {
    first.width = 0;
    first.height = 0;
    second.width = 0;
    second.height = 0;
  }
}

function drawReferencePage(canvas, input) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 PDF 第 1 页画布。');
  fillPage(context);
  drawText(context, '球衣定制生产参考', 72, 86, '700 42px "Microsoft YaHei", sans-serif');
  drawText(
    context,
    '本地设计，尚未关联 Shopify 订单',
    72,
    136,
    '24px "Microsoft YaHei", sans-serif',
  );
  drawText(context, '第 1 / 2 页', 1470, 86, '22px "Microsoft YaHei", sans-serif');
  drawMetadataRows(context, input, 72, 200);
  drawContainedImage(context, input.previewFront, {
    x: 72,
    y: 500,
    width: 720,
    height: 520,
  });
  drawContainedImage(context, input.previewBack, {
    x: 892,
    y: 500,
    width: 720,
    height: 520,
  });
  drawText(context, '正面预览', 72, 1060, '700 26px "Microsoft YaHei", sans-serif');
  drawText(context, '背面预览', 892, 1060, '700 26px "Microsoft YaHei", sans-serif');
  drawText(
    context,
    WARNING,
    72,
    1134,
    '700 24px "Microsoft YaHei", sans-serif',
    '#b42318',
  );
}

function drawPatternPiecesPage(canvas, input) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 PDF 第 2 页画布。');
  fillPage(context);
  drawText(context, 'UV 裁片排版参考', 72, 70, '700 36px "Microsoft YaHei", sans-serif');
  drawContainedImage(context, input.pieces, {
    x: 72,
    y: 110,
    width: 1540,
    height: 930,
  });
  drawText(
    context,
    `${input.piecesSize.width} × ${input.piecesSize.height} 像素`,
    72,
    1080,
    '22px "Microsoft YaHei", sans-serif',
  );
  drawText(
    context,
    `设计指纹：${input.designFingerprint}`,
    620,
    1080,
    '22px "Microsoft YaHei", sans-serif',
  );
  drawText(context, '第 2 / 2 页', 1470, 1080, '22px "Microsoft YaHei", sans-serif');
  drawText(
    context,
    WARNING,
    72,
    1134,
    '700 24px "Microsoft YaHei", sans-serif',
    '#b42318',
  );
}

function fillPage(context) {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
}

function drawMetadataRows(context, input, x, y) {
  const rows = [
    ['产品', input.productName],
    ['尺码', input.sizeLabel],
    ['模型', `${input.model.id} / ${input.model.version}`],
    ['UV 导出版本', input.model.uvExportVersion],
    ['设计指纹', input.designFingerprint],
    ['生成时间', input.generatedAt],
    ['Atlas', `${input.atlasSize} × ${input.atlasSize} 像素，sRGB 参考`],
    ['模板', input.templateLabel],
    ...input.zoneColors.map((zone) => [zone.label, zone.value]),
  ];
  rows.forEach(([label, value], index) => {
    const columnX = x + Math.floor(index / 7) * 770;
    const rowY = y + (index % 7) * 34;
    drawText(
      context,
      `${label}：`,
      columnX,
      rowY,
      '700 20px "Microsoft YaHei", sans-serif',
    );
    drawText(
      context,
      value,
      columnX + 170,
      rowY,
      '20px "Microsoft YaHei", sans-serif',
    );
  });
}

function drawText(context, text, x, y, font, color = '#20242a') {
  context.fillStyle = color;
  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(String(text), x, y);
}

function drawContainedImage(context, image, box) {
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(
    image,
    box.x + (box.width - width) / 2,
    box.y + (box.height - height) / 2,
    width,
    height,
  );
}

function canvasToJpegBytes(canvas) {
  if (typeof canvas.toBlob !== 'function') {
    throw new Error('无法生成 PDF 页面图像。');
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob?.size) {
        reject(new Error('无法生成 PDF 页面图像。'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', 0.94);
  });
}

function buildRasterPdf(firstJpeg, secondJpeg) {
  const content = ascii(`q ${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm /Im0 Do Q`);
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    streamObject(
      `/Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${firstJpeg.length}`,
      firstJpeg,
    ),
    streamObject(`/Length ${content.length}`, content),
    ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >>`),
    streamObject(
      `/Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${secondJpeg.length}`,
      secondJpeg,
    ),
    streamObject(`/Length ${content.length}`, content),
  ];
  const chunks = [ascii('%PDF-1.4\n%âãÏÓ\n')];
  const offsets = [0];
  let byteLength = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const chunk = concatenate([
      ascii(`${index + 1} 0 obj\n`),
      object,
      ascii('\nendobj\n'),
    ]);
    chunks.push(chunk);
    byteLength += chunk.length;
  });

  const xrefOffset = byteLength;
  const rows = offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  chunks.push(ascii(
    `xref\n0 9\n0000000000 65535 f \n${rows}`
    + `trailer\n<< /Size 9 /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF`,
  ));
  return concatenate(chunks);
}

function streamObject(dictionary, bytes) {
  return concatenate([
    ascii(`<< ${dictionary} >>\nstream\n`),
    bytes,
    ascii('\nendstream'),
  ]);
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concatenate(chunks) {
  const result = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function defaultCreateCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function validateInput(input) {
  if (!input?.pieces) {
    throw new Error('PDF 生产参考数据不完整：缺少 UV 裁片排版图。');
  }
  if (
    !input.previewFront
    || !input.previewBack
    || !Number.isInteger(input.atlasSize)
    || input.atlasSize < 1
    || !Number.isInteger(input.piecesSize?.width)
    || input.piecesSize.width < 1
    || !Number.isInteger(input.piecesSize?.height)
    || input.piecesSize.height < 1
    || typeof input.designFingerprint !== 'string'
    || !input.model
    || !Array.isArray(input.zoneColors)
  ) {
    throw new Error('PDF 生产参考数据不完整。');
  }
}
