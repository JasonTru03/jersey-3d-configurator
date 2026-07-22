const EPSILON = Number.EPSILON;
const TWO_PI = Math.PI * 2;

export function createCylindricalProjector({ center, minY, maxY, frontAngleDeg = 0 }) {
  const front = (frontAngleDeg * Math.PI) / 180;
  const height = Math.max(maxY - minY, EPSILON);

  return {
    project: ({ x, y, z }) => ({
      u: (Math.atan2(x - center.x, z - center.z) - front) / TWO_PI + 0.5,
      v: (y - minY) / height,
    }),
  };
}

export function selectGarmentPatternMeshes(meshes) {
  return meshes.filter(({ name }) => /cloth|fabric|body/i.test(name));
}
