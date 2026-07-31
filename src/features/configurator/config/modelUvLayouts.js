import { APPEARANCE_ZONES } from './appearance.js';

function freezeLayout(layout) {
  return Object.freeze({
    ...layout,
    pieceGroups: Object.freeze(layout.pieceGroups.map((group) => Object.freeze({
      ...group,
      islandRefs: Object.freeze(group.islandRefs.map((island) => Object.freeze(island))),
    }))),
  });
}

export const MODEL_UV_LAYOUTS = Object.freeze({
  'chelsea-jersey@1': freezeLayout({
    version: 1,
    pieceGroups: [
      {
        id: 'front',
        label: '正片',
        order: 0,
        zone: 'body',
        rotation: 0,
        mirrorX: false,
        islandRefs: [{ meshName: 'Cloth_mesh_7' }],
      },
      {
        id: 'back',
        label: '背片',
        order: 1,
        zone: 'body',
        rotation: 0,
        mirrorX: false,
        islandRefs: [{ meshName: 'Cloth_mesh_4' }],
      },
    ],
  }),
  'fn8788-jersey@1': freezeLayout({
    version: 1,
    pieceGroups: [
      {
        id: 'front',
        label: '正片',
        order: 0,
        zone: 'body',
        rotation: 0,
        mirrorX: false,
        islandRefs: [{ meshName: 'Cloth_mesh_1' }],
      },
      {
        id: 'back',
        label: '背片',
        order: 1,
        zone: 'body',
        rotation: 0,
        mirrorX: false,
        islandRefs: [{ meshName: 'Cloth_mesh_5' }],
      },
    ],
  }),
});

export function getModelUvLayout(model) {
  const key = `${model?.id}@${model?.version}`;
  const layout = MODEL_UV_LAYOUTS[key];
  if (!layout) throw new Error(`模型 "${key}" 缺少 UV 裁片配置。`);
  return layout;
}

export function validateModelUvLayout(layout, meshes) {
  if (!isObject(layout)) {
    throwInvalidLayout('配置必须是对象');
  }
  if (!Number.isInteger(layout.version) || layout.version <= 0) {
    throwInvalidLayout('version 版本必须是正整数');
  }
  if (!Array.isArray(layout.pieceGroups) || layout.pieceGroups.length === 0) {
    throwInvalidLayout('pieceGroups 裁片组必须是非空数组');
  }

  const ids = new Set();
  for (const [index, group] of layout.pieceGroups.entries()) {
    if (!isObject(group)) {
      throwInvalidLayout(`第 ${index + 1} 个裁片组必须是对象`);
    }
    if (!isNonEmptyString(group.id)) {
      throwInvalidLayout(`第 ${index + 1} 个裁片组的 id 必须是非空字符串`);
    }
    if (ids.has(group.id)) {
      throwInvalidLayout(`裁片组 id "${group.id}" 重复`);
    }
    ids.add(group.id);
  }
  if (!ids.has('front') || !ids.has('back')) {
    throw new Error('模型 UV 裁片配置必须至少包含正片和背片。');
  }

  const orders = new Set();
  for (const group of layout.pieceGroups) {
    if (!isNonEmptyString(group.label)) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 label 必须是非空字符串`);
    }
    if (!isNonEmptyString(group.zone)) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 zone 必须是非空字符串`);
    }
    if (!APPEARANCE_ZONES.includes(group.zone)) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 zone "${group.zone}" 不受支持`);
    }
    if (!Number.isInteger(group.order) || group.order < 0) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 order 必须是非负整数`);
    }
    if (orders.has(group.order)) {
      throwInvalidLayout(`裁片组 order "${group.order}" 重复`);
    }
    orders.add(group.order);
    if (!Number.isFinite(group.rotation) || ![0, 90, 180, 270].includes(group.rotation)) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 rotation 必须是 0、90、180 或 270 度`);
    }
    if (typeof group.mirrorX !== 'boolean') {
      throwInvalidLayout(`裁片组 "${group.id}" 的 mirrorX 必须是 boolean`);
    }
    if (!Array.isArray(group.islandRefs) || group.islandRefs.length === 0) {
      throwInvalidLayout(`裁片组 "${group.id}" 的 islandRefs 必须是非空数组`);
    }
    for (const [index, island] of group.islandRefs.entries()) {
      if (!isObject(island)) {
        throwInvalidLayout(`裁片组 "${group.id}" 的第 ${index + 1} 个 UV 岛引用必须是对象`);
      }
      if (!isNonEmptyString(island.meshName)) {
        throwInvalidLayout(`裁片组 "${group.id}" 的 meshName 必须是非空字符串`);
      }
    }
  }

  if (!Array.isArray(meshes)) {
    throw new Error('模型 UV 裁片配置校验失败：网格列表必须是数组。');
  }
  for (const mesh of meshes) {
    if (!isObject(mesh) || !isNonEmptyString(mesh.name)) {
      throw new Error('模型 UV 裁片配置校验失败：网格列表包含无效网格项。');
    }
  }

  const available = new Set(meshes.map((mesh) => mesh.name));
  for (const group of layout.pieceGroups) {
    for (const island of group.islandRefs) {
      if (!available.has(island.meshName)) {
        throw new Error(`UV 裁片 "${group.id}" 找不到网格 "${island.meshName}"。`);
      }
    }
  }
  return true;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function throwInvalidLayout(message) {
  throw new Error(`模型 UV 裁片配置错误：${message}。`);
}
