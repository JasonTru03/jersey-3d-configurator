import { Matrix3, Vector3 } from 'three';

export const SURFACE_FACING_THRESHOLD = 0.08;
export const ELEMENT_SURFACE_EPSILON = 0.04;

export function getWorldIntersectionNormal(hit) {
  if (!hit?.object?.matrixWorld || !(hit?.face?.normal instanceof Vector3)) return null;

  const normalMatrix = new Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

export function isIntersectionFacingRay(
  hit,
  rayDirection,
  threshold = SURFACE_FACING_THRESHOLD,
) {
  if (!(rayDirection instanceof Vector3) || rayDirection.lengthSq() === 0) return false;

  const worldNormal = getWorldIntersectionNormal(hit);
  if (!worldNormal) return false;

  return worldNormal.dot(rayDirection.clone().normalize()) <= -threshold;
}

export function findNearestFacingIntersection(raycaster, objects, recursive = false) {
  if (
    !raycaster
    || typeof raycaster.intersectObjects !== 'function'
    || !Array.isArray(objects)
    || objects.length === 0
  ) {
    return null;
  }

  const intersections = raycaster.intersectObjects(objects, recursive);
  if (!Array.isArray(intersections)) return null;

  return intersections.find((hit) => (
    isIntersectionFacingRay(hit, raycaster.ray?.direction)
  )) ?? null;
}

export function findVisibleElementIntersection({
  elements,
  garmentMeshes,
  raycaster,
  recursive = false,
  surfaceEpsilon = ELEMENT_SURFACE_EPSILON,
} = {}) {
  if (
    !raycaster
    || typeof raycaster.intersectObjects !== 'function'
    || !Array.isArray(elements)
    || elements.length === 0
  ) {
    return null;
  }

  const intersections = raycaster.intersectObjects(elements, recursive);
  if (!Array.isArray(intersections)) return null;

  const candidates = intersections.filter((hit) => (
    isIntersectionFacingRay(hit, raycaster.ray?.direction)
  ));
  if (candidates.length === 0) return null;

  const garmentHit = findNearestFacingIntersection(raycaster, garmentMeshes, recursive);
  if (!garmentHit) return candidates[0];

  return candidates.find((candidate) => (
    candidate.distance <= garmentHit.distance + surfaceEpsilon
  )) ?? null;
}
