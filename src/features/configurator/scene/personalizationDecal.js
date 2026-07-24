import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const SURFACE_RAY_OFFSET = 0.18;
const DECAL_DEPTH = 0.08;
const FORWARD = new THREE.Vector3(0, 0, 1);

function finiteVector(value) {
  if (!value) return null;
  const vector = value.isVector3
    ? value.clone()
    : new THREE.Vector3(value.x, value.y, value.z);
  return vector.toArray().every(Number.isFinite) ? vector : null;
}

export function resolvePersonalizationSurface(meshes = [], placement) {
  if (!placement || !Array.isArray(meshes) || !meshes.length) return null;
  const position = finiteVector(placement.position ?? placement);
  const normal = finiteVector(placement.normal ?? FORWARD);
  if (!position || !normal || normal.lengthSq() === 0) return null;
  normal.normalize();

  const origin = position.clone().addScaledVector(normal, SURFACE_RAY_OFFSET);
  const raycaster = new THREE.Raycaster(origin, normal.clone().negate());
  const hit = raycaster.intersectObjects(meshes.filter((mesh) => mesh?.isMesh), false)[0];
  if (!hit?.face || !hit.object?.isMesh) return null;

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  const surfaceNormal = hit.face.normal.clone().applyMatrix3(normalMatrix);
  if (!surfaceNormal.toArray().every(Number.isFinite) || surfaceNormal.lengthSq() === 0) return null;

  return {
    mesh: hit.object,
    point: hit.point.clone(),
    normal: surfaceNormal.normalize(),
  };
}

export function getPersonalizationDecalOrientation(normalValue, rotation = 0) {
  const normal = finiteVector(normalValue);
  const angle = Number(rotation);
  if (!normal || normal.lengthSq() === 0 || !Number.isFinite(angle)) {
    throw new TypeError('Personalization decal orientation requires a finite normal and rotation.');
  }
  normal.normalize();
  return new THREE.Quaternion()
    .setFromUnitVectors(FORWARD, normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(
      FORWARD,
      THREE.MathUtils.degToRad(angle),
    ))
    .normalize();
}

export function createPersonalizationDecalGeometry({
  height,
  mesh,
  normal,
  position,
  rotation = 0,
  scale = 1,
  width,
}) {
  const decalPosition = finiteVector(position);
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const numericScale = Number(scale);
  if (!mesh?.isMesh || !decalPosition) {
    throw new TypeError('Personalization decal requires a mesh and finite position.');
  }
  if (![numericWidth, numericHeight, numericScale].every(Number.isFinite)
    || numericWidth <= 0 || numericHeight <= 0 || numericScale <= 0) {
    throw new RangeError('Personalization decal dimensions and scale must be positive.');
  }

  const orientation = getPersonalizationDecalOrientation(normal, rotation);
  return new DecalGeometry(
    mesh,
    decalPosition,
    new THREE.Euler().setFromQuaternion(orientation),
    new THREE.Vector3(
      numericWidth * numericScale,
      numericHeight * numericScale,
      DECAL_DEPTH,
    ),
  );
}
