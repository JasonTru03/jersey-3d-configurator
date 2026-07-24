import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const SURFACE_RAY_OFFSET = 0.18;
const MIN_DECAL_DEPTH = 0.12;
const MAX_DECAL_DEPTH = 1.2;
const FACING_NORMAL_THRESHOLD = 0.08;
const FORWARD = new THREE.Vector3(0, 0, 1);
const FOOTPRINT_SAMPLE_COORDINATES = [
  [0, 0],
  [-0.5, 0],
  [0.5, 0],
  [0, -0.5],
  [0, 0.5],
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function finiteVector(value) {
  if (!value) return null;
  const vector = value.isVector3
    ? value.clone()
    : new THREE.Vector3(value.x, value.y, value.z);
  return vector.toArray().every(Number.isFinite) ? vector : null;
}

export function supportsPersonalizationDecalMesh(mesh) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh) return false;
  return !mesh.morphTargetInfluences?.some((influence) => (
    Number.isFinite(influence) && Math.abs(influence) > 0.000001
  ));
}

export function resolvePersonalizationSurface(meshes = [], placement, footprint = null) {
  if (!placement || !Array.isArray(meshes) || !meshes.length) return null;
  const position = finiteVector(placement.position ?? placement);
  const normal = finiteVector(placement.normal ?? FORWARD);
  if (!position || !normal || normal.lengthSq() === 0) return null;
  normal.normalize();
  const supportedMeshes = meshes.filter(supportsPersonalizationDecalMesh);
  if (!supportedMeshes.length) return null;

  const dimensions = getFootprintDimensions(footprint);
  const orientation = getPersonalizationDecalOrientation(normal, footprint?.rotation ?? 0);
  const horizontal = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
  const vertical = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
  const offsets = dimensions
    ? FOOTPRINT_SAMPLE_COORDINATES.map(([x, y]) => ({
        distance: Math.hypot(x, y),
        point: position.clone()
          .addScaledVector(horizontal, x * dimensions.width / 2)
          .addScaledVector(vertical, y * dimensions.height / 2),
      }))
    : [{ distance: 0, point: position.clone() }];
  const rayOffset = Math.max(
    SURFACE_RAY_OFFSET,
    dimensions ? Math.max(dimensions.width, dimensions.height) * 0.7 : 0,
  );
  const samples = offsets.flatMap((sample) => {
    const origin = sample.point.clone().addScaledVector(normal, rayOffset);
    const hits = new THREE.Raycaster(origin, normal.clone().negate())
      .intersectObjects(supportedMeshes, false);
    const surface = hits
      .map(getPersonalizationSurfaceFromIntersection)
      .find((candidate) => candidate && candidate.normal.dot(normal) >= FACING_NORMAL_THRESHOLD);
    return surface ? [{ ...sample, surface }] : [];
  });
  if (!samples.length) return null;

  const meshCounts = new Map();
  samples.forEach(({ surface }) => {
    meshCounts.set(surface.mesh, (meshCounts.get(surface.mesh) ?? 0) + 1);
  });
  const selectedMesh = [...meshCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0][0];
  const selectedSamples = samples
    .filter(({ surface }) => surface.mesh === selectedMesh)
    .sort((a, b) => a.distance - b.distance);
  const primary = selectedSamples[0].surface;
  const projected = projectPersonalizationCenterOntoSurface(primary, position);
  const deviations = selectedSamples.map(({ surface }) => (
    Math.abs(surface.point.clone().sub(projected.point).dot(projected.normal))
  ));
  return {
    ...projected,
    depth: getAdaptiveDecalDepth(dimensions, Math.max(0, ...deviations)),
    sampleCount: selectedSamples.length,
  };
}

export function getPersonalizationSurfaceFromIntersection(hit) {
  if (!hit?.object?.isMesh || !hit.face || !hit.point) return null;
  const point = finiteVector(hit.point);
  const faceNormal = finiteVector(hit.face.normal);
  if (!point || !faceNormal || faceNormal.lengthSq() === 0) return null;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  const normal = faceNormal.applyMatrix3(normalMatrix);
  if (!normal.toArray().every(Number.isFinite) || normal.lengthSq() === 0) return null;
  return {
    mesh: hit.object,
    point,
    normal: normal.normalize(),
  };
}

export function projectPersonalizationCenterOntoSurface(surface, centerValue) {
  const center = finiteVector(centerValue);
  const point = finiteVector(surface?.point);
  const normal = finiteVector(surface?.normal);
  if (!surface?.mesh?.isMesh || !center || !point || !normal || normal.lengthSq() === 0) {
    return null;
  }
  normal.normalize();
  return {
    mesh: surface.mesh,
    normal,
    point: center.addScaledVector(normal, -center.clone().sub(point).dot(normal)),
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
  depth,
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
  const projectionDepth = Number.isFinite(Number(depth)) && Number(depth) > 0
    ? Math.min(MAX_DECAL_DEPTH, Math.max(MIN_DECAL_DEPTH, Number(depth)))
    : getAdaptiveDecalDepth({
        height: numericHeight * numericScale,
        width: numericWidth * numericScale,
      }, 0);
  const rawGeometry = new DecalGeometry(
    mesh,
    decalPosition,
    new THREE.Euler().setFromQuaternion(orientation),
    new THREE.Vector3(
      numericWidth * numericScale,
      numericHeight * numericScale,
      projectionDepth,
    ),
  );
  const geometry = filterFacingDecalTriangles(rawGeometry, finiteVector(normal).normalize());
  rawGeometry.dispose();
  geometry.userData.projectionDepth = projectionDepth;
  return geometry;
}

function getFootprintDimensions(footprint) {
  const width = Number(footprint?.width) * Number(footprint?.scale ?? 1);
  const height = Number(footprint?.height) * Number(footprint?.scale ?? 1);
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function getAdaptiveDecalDepth(dimensions, surfaceDeviation) {
  const minimumDimension = dimensions
    ? Math.min(dimensions.width, dimensions.height)
    : MIN_DECAL_DEPTH;
  return Math.min(
    MAX_DECAL_DEPTH,
    Math.max(MIN_DECAL_DEPTH, surfaceDeviation * 2 + minimumDimension * 0.55),
  );
}

function filterFacingDecalTriangles(source, targetNormal) {
  const position = source.getAttribute('position');
  const uv = source.getAttribute('uv');
  const normal = source.getAttribute('normal');
  const positions = [];
  const uvs = [];
  const normals = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const edge = new THREE.Vector3();

  for (let index = 0; index + 2 < (position?.count ?? 0); index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);
    faceNormal.subVectors(b, a).cross(edge.subVectors(c, a));
    if (faceNormal.lengthSq() === 0
      || faceNormal.normalize().dot(targetNormal) < FACING_NORMAL_THRESHOLD) continue;
    for (let vertex = index; vertex < index + 3; vertex += 1) {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      if (uv) uvs.push(uv.getX(vertex), uv.getY(vertex));
      if (normal) normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (normal) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}
