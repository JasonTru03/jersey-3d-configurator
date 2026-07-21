import { readFileSync } from 'node:fs';

const modelPath = new URL('../public/models/chelsea-jersey.glb', import.meta.url);
const model = readFileSync(modelPath);

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;

if (model.length < 20 || model.readUInt32LE(0) !== glbMagic) {
  throw new Error('Garment UV verification failed: 0 primitives have no TEXCOORD_0.');
}

let offset = 12;
let document;

while (offset + 8 <= model.length) {
  const chunkLength = model.readUInt32LE(offset);
  const chunkType = model.readUInt32LE(offset + 4);
  const chunkStart = offset + 8;
  const chunkEnd = chunkStart + chunkLength;

  if (chunkEnd > model.length) {
    break;
  }

  if (chunkType === jsonChunkType) {
    document = JSON.parse(model.toString('utf8', chunkStart, chunkEnd).trim());
    break;
  }

  offset = chunkEnd;
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
