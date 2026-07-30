import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const SURFACE_RAY_OFFSET = 0.18;
const MIN_DECAL_DEPTH = 0.12;
const MAX_DECAL_DEPTH = 1.2;
const FACING_NORMAL_THRESHOLD = 0.08;
const FORWARD = new THREE.Vector3(0, 0, 1);
const GARMENT_UP = new THREE.Vector3(0, 1, 0);
const MIN_TANGENT_LENGTH_SQ = 1e-8;
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

  const samplesByMesh = new Map();
  samples.forEach((sample) => {
    const meshSamples = samplesByMesh.get(sample.surface.mesh) ?? [];
    meshSamples.push(sample);
    samplesByMesh.set(sample.surface.mesh, meshSamples);
  });
  const surfaces = [...samplesByMesh.values()].map((meshSamples) => {
    const sortedSamples = meshSamples.sort((a, b) => a.distance - b.distance);
    const projected = projectPersonalizationCenterOntoSurface(
      sortedSamples[0].surface,
      position,
    );
    const deviations = sortedSamples.map(({ surface }) => (
      Math.abs(surface.point.clone().sub(projected.point).dot(projected.normal))
    ));
    return {
      ...projected,
      depth: getAdaptiveDecalDepth(dimensions, Math.max(0, ...deviations)),
      minimumSampleDistance: sortedSamples[0].distance,
      sampleCount: sortedSamples.length,
    };
  }).sort((a, b) => (
    a.minimumSampleDistance - b.minimumSampleDistance
    || b.sampleCount - a.sampleCount
  ));
  const primary = surfaces[0];
  return {
    ...primary,
    sampleCount: samples.length,
    surfaces,
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
  const up = GARMENT_UP.clone().addScaledVector(normal, -GARMENT_UP.dot(normal));
  if (up.lengthSq() < MIN_TANGENT_LENGTH_SQ) {
    up.copy(FORWARD).addScaledVector(normal, -FORWARD.dot(normal));
  }
  up.normalize();
  const right = up.clone().cross(normal).normalize();
  up.crossVectors(normal, right).normalize();
  const surfaceOrientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, normal),
  );
  return surfaceOrientation
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
  surfaces,
  width,
}) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const numericScale = Number(scale);
  const projectionSurfaces = Array.isArray(surfaces) && surfaces.length
    ? surfaces
    : [{ depth, mesh, normal, point: position }];
  if (!projectionSurfaces.every((surface) => (
    surface?.mesh?.isMesh
    && finiteVector(surface.point)
    && finiteVector(surface.normal)?.lengthSq() > 0
  ))) {
    throw new TypeError('Personalization decal requires a mesh and finite position.');
  }
  if (![numericWidth, numericHeight, numericScale].every(Number.isFinite)
    || numericWidth <= 0 || numericHeight <= 0 || numericScale <= 0) {
    throw new RangeError('Personalization decal dimensions and scale must be positive.');
  }

  const geometries = projectionSurfaces.map((surface) => {
    const surfaceNormal = finiteVector(surface.normal).normalize();
    const orientation = getPersonalizationDecalOrientation(surfaceNormal, rotation);
    const projectionDepth = Number.isFinite(Number(surface.depth)) && Number(surface.depth) > 0
      ? Math.min(MAX_DECAL_DEPTH, Math.max(MIN_DECAL_DEPTH, Number(surface.depth)))
      : getAdaptiveDecalDepth({
          height: numericHeight * numericScale,
          width: numericWidth * numericScale,
        }, 0);
    const rawGeometry = new DecalGeometry(
      surface.mesh,
      finiteVector(surface.point),
      new THREE.Euler().setFromQuaternion(orientation),
      new THREE.Vector3(
        numericWidth * numericScale,
        numericHeight * numericScale,
        projectionDepth,
      ),
    );
    const geometry = filterFacingDecalTriangles(
      rawGeometry,
      surfaceNormal,
      Math.sign(surface.mesh.matrixWorld.determinant()) || 1,
    );
    rawGeometry.dispose();
    geometry.userData.projectionDepth = projectionDepth;
    return geometry;
  });
  const geometry = mergePersonalizationDecalGeometries(geometries);
  geometry.userData.projectionDepth = Math.max(
    ...geometries.map((item) => item.userData.projectionDepth),
  );
  geometry.userData.surfaceCount = projectionSurfaces.length;
  geometries.forEach((item) => item.dispose());
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

function filterFacingDecalTriangles(source, targetNormal, windingSign) {
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
      || faceNormal.normalize().multiplyScalar(windingSign).dot(targetNormal)
        < FACING_NORMAL_THRESHOLD) continue;
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

function mergePersonalizationDecalGeometries(geometries) {
  const positions = [];
  const uvs = [];
  const normals = [];
  geometries.forEach((geometry) => {
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    for (let index = 0; index < (position?.count ?? 0); index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      if (uv) uvs.push(uv.getX(index), uv.getY(index));
      if (normal) normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
    }
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs.length) merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (normals.length) merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return merged;
}

export function getPersonalizationAlphaMask(canvas, sampleStep = 4) {
  if (!canvas?.width || !canvas?.height || typeof canvas.getContext !== 'function') return null;
  const context = canvas.getContext('2d');
  if (typeof context?.getImageData !== 'function') return null;
  let imageData;
  try {
    imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  const samples = [];
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  const step = Math.max(1, Math.floor(sampleStep));
  const sampledBlocks = new Set();
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (imageData.data[(y * canvas.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const block = `${Math.floor(x / step)}:${Math.floor(y / step)}`;
      if (sampledBlocks.has(block)) continue;
      sampledBlocks.add(block);
      samples.push(new THREE.Vector2(
        (x + 0.5) / canvas.width,
        1 - (y + 0.5) / canvas.height,
      ));
    }
  }
  if (!samples.length) return null;
  return {
    bounds: {
      minU: (minX + 0.5) / canvas.width,
      maxU: (maxX + 0.5) / canvas.width,
      minV: 1 - (maxY + 0.5) / canvas.height,
      maxV: 1 - (minY + 0.5) / canvas.height,
    },
    samples,
  };
}

export function getPersonalizationUvCoverage(geometry, alphaMask) {
  if (!alphaMask?.samples?.length) return null;
  const uv = geometry?.getAttribute?.('uv');
  if (!uv?.count) return 0;
  let covered = 0;
  alphaMask.samples.forEach((sample) => {
    if (uvContainsPoint(uv, sample)) covered += 1;
  });
  return covered / alphaMask.samples.length;
}

export function shouldUsePersonalizationDecal(
  geometry,
  alphaMask,
  minimumCoverage = 0.985,
) {
  const position = geometry?.getAttribute?.('position');
  if (!position?.count) return false;
  const coverage = getPersonalizationUvCoverage(geometry, alphaMask);
  return coverage === null || coverage >= minimumCoverage;
}

export function fitPersonalizationDecalToSurface({
  alphaMask,
  height,
  meshes,
  minimumCoverage = 0.985,
  minimumScale = 0.55,
  placement,
  rotation = 0,
  scale = 1,
  width,
}) {
  const requestedScale = Number(scale);
  const floorScale = Math.min(requestedScale, Number(minimumScale));
  if (![requestedScale, floorScale].every(Number.isFinite)
    || requestedScale <= 0 || floorScale <= 0) return null;

  const createCandidate = (candidateScale) => {
    const footprint = {
      height,
      rotation,
      scale: candidateScale,
      width,
    };
    const surface = resolvePersonalizationSurface(meshes, placement, footprint);
    if (!surface) return null;
    const geometry = createPersonalizationDecalGeometry({
      ...footprint,
      depth: surface.depth,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      surfaces: surface.surfaces,
    });
    const coverage = getPersonalizationUvCoverage(geometry, alphaMask);
    return {
      coverage,
      geometry,
      scale: candidateScale,
      surface,
      valid: coverage === null || coverage >= minimumCoverage,
    };
  };

  const requested = createCandidate(requestedScale);
  if (requested?.valid) return requested;
  requested?.geometry.dispose();

  let lower = createCandidate(floorScale);
  if (!lower?.valid) {
    lower?.geometry.dispose();
    return null;
  }
  if (floorScale === requestedScale) return lower;

  let lowerScale = floorScale;
  let upperScale = requestedScale;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const candidateScale = (lowerScale + upperScale) / 2;
    const candidate = createCandidate(candidateScale);
    if (candidate?.valid) {
      lower.geometry.dispose();
      lower = candidate;
      lowerScale = candidateScale;
    } else {
      candidate?.geometry.dispose();
      upperScale = candidateScale;
    }
  }
  return lower;
}

function uvContainsPoint(uv, point) {
  const a = new THREE.Vector2();
  const b = new THREE.Vector2();
  const c = new THREE.Vector2();
  for (let index = 0; index + 2 < uv.count; index += 3) {
    a.fromBufferAttribute(uv, index);
    b.fromBufferAttribute(uv, index + 1);
    c.fromBufferAttribute(uv, index + 2);
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 0.0000001) continue;
    const alpha = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y))
      / denominator;
    const beta = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y))
      / denominator;
    if (alpha >= -0.000001 && beta >= -0.000001 && 1 - alpha - beta >= -0.000001) {
      return true;
    }
  }
  return false;
}
