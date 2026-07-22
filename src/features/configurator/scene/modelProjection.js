const EPSILON = Number.EPSILON;
const TWO_PI = Math.PI * 2;

export function createCylindricalProjector({ center, minY, maxY, frontAngleDeg = 0 }) {
  const front = (frontAngleDeg * Math.PI) / 180;
  const heightRange = maxY - minY;
  const height = Math.max(heightRange, EPSILON);

  return {
    project: ({ x, y, z }) => {
      const unwrappedU = (Math.atan2(x - center.x, z - center.z) - front) / TWO_PI + 0.5;

      return {
        u: ((unwrappedU % 1) + 1) % 1,
        v: heightRange === 0 ? 0 : (y - minY) / height,
      };
    },
  };
}

export function selectGarmentPatternMeshes(meshes) {
  const matches = meshes.filter(({ name }) => /cloth|fabric|body/i.test(name));
  return matches.length > 0 ? matches : meshes;
}
