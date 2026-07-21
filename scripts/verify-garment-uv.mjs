import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modelPath = fileURLToPath(
  new URL('../public/models/chelsea-jersey.glb', import.meta.url),
);
const model = readFileSync(modelPath);

const glbMagic = 0x46546c67;
const glbVersion = 2;
const jsonChunkType = 0x4e4f534a;

function failInvalidGlb(reason) {
  throw new Error(
    `Garment UV verification failed: invalid GLB at ${modelPath}: ${reason}.`,
  );
}

if (model.length < 12) {
  failInvalidGlb('header is truncated');
}

if (model.readUInt32LE(0) !== glbMagic) {
  failInvalidGlb('magic is not glTF');
}

if (model.readUInt32LE(4) !== glbVersion) {
  failInvalidGlb(`version is ${model.readUInt32LE(4)}, expected 2`);
}

if (model.readUInt32LE(8) !== model.length) {
  failInvalidGlb(
    `header length is ${model.readUInt32LE(8)}, actual length is ${model.length}`,
  );
}

if (model.length < 20) {
  failInvalidGlb('first JSON chunk header is missing');
}

const jsonChunkLength = model.readUInt32LE(12);
const firstChunkType = model.readUInt32LE(16);
const jsonChunkStart = 20;
const jsonChunkEnd = jsonChunkStart + jsonChunkLength;

if (firstChunkType !== jsonChunkType) {
  failInvalidGlb('first chunk is not JSON');
}

if (jsonChunkEnd > model.length) {
  failInvalidGlb('first JSON chunk is truncated');
}

let document;

try {
  document = JSON.parse(model.toString('utf8', jsonChunkStart, jsonChunkEnd).trim());
} catch (error) {
  failInvalidGlb(`JSON parsing failed: ${error.message}`);
}

const primitives = document?.meshes?.flatMap((mesh) => mesh.primitives ?? []) ?? [];
const primitivesWithoutUv = primitives.filter(
  (primitive) => primitive.attributes?.TEXCOORD_0 === undefined,
).length;

if (primitives.length === 0 || primitivesWithoutUv > 0) {
  throw new Error(
    `Garment UV verification failed: ${primitivesWithoutUv} primitives have no TEXCOORD_0.`,
  );
}

console.log(
  `Garment UV verification passed: ${primitives.length} primitives expose TEXCOORD_0.`,
);
