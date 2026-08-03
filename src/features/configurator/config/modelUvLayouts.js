import { APPEARANCE_ZONES } from './appearance.js';

function freezeLayout(layout) {
  const frozenLayout = {
    ...layout,
    pieceGroups: freezeGroups(layout.pieceGroups),
  };
  if (layout.appearanceGroups) {
    frozenLayout.appearanceGroups = freezeGroups(layout.appearanceGroups);
  }
  if (layout.patternOutputTransform !== undefined) {
    frozenLayout.patternOutputTransform = Object.freeze({ ...layout.patternOutputTransform });
  }
  return Object.freeze(frozenLayout);
}

function freezeGroups(groups) {
  return Object.freeze(groups.map((group) => Object.freeze({
    ...group,
    islandRefs: Object.freeze(group.islandRefs.map((island) => Object.freeze(island))),
  })));
}

export const MODEL_UV_LAYOUTS = Object.freeze({
  'chelsea-jersey@1': freezeLayout({
    version: 2,
    // 当前需先旋转180再水平镜像；未来若模型已朝上 rotation 改0，若文字已正向 mirrorX 改false。
    patternOutputTransform: { rotation: 180, mirrorX: true },
    pieceGroups: [
      {
        id: 'front',
        label: '正片',
        order: 0,
        zone: 'body',
        rotation: 180,
        mirrorX: true,
        islandRefs: [{ meshName: 'Cloth_mesh_7' }],
      },
      {
        id: 'back',
        label: '背片',
        order: 1,
        zone: 'body',
        rotation: 180,
        mirrorX: true,
        islandRefs: [{ meshName: 'Cloth_mesh_4' }],
      },
    ],
    appearanceGroups: [
      {
        id: 'body',
        order: 0,
        zone: 'body',
        islandRefs: [
          { meshName: 'Cloth_mesh_7' },
          { meshName: 'Cloth_mesh_4' },
        ],
      },
      {
        id: 'sleeves',
        order: 1,
        zone: 'sleeves',
        islandRefs: [
          { meshName: 'Cloth_mesh' },
          { meshName: 'Cloth_mesh_1' },
          { meshName: 'Cloth_mesh_2' },
          { meshName: 'Cloth_mesh_13' },
          { meshName: 'Cloth_mesh_14' },
          { meshName: 'Cloth_mesh_15' },
        ],
      },
      {
        id: 'shoulderSide',
        order: 2,
        zone: 'shoulderSide',
        islandRefs: [
          { meshName: 'Cloth_mesh_3' },
          { meshName: 'Cloth_mesh_5' },
          { meshName: 'Cloth_mesh_6' },
          { meshName: 'Cloth_mesh_10' },
          { meshName: 'Cloth_mesh_11' },
          { meshName: 'Cloth_mesh_12' },
        ],
      },
      {
        id: 'collar',
        order: 3,
        zone: 'collar',
        islandRefs: [
          { meshName: 'Cloth_mesh_8' },
          { meshName: 'Cloth_mesh_9' },
          { meshName: 'Cloth_mesh_16' },
          { meshName: 'Cloth_mesh_17' },
          { meshName: 'Cloth_mesh_18' },
        ],
      },
    ],
  }),
  'fn8788-jersey@1': freezeLayout({
    version: 2,
    // 当前需先旋转180再水平镜像；未来若模型已朝上 rotation 改0，若文字已正向 mirrorX 改false。
    patternOutputTransform: { rotation: 180, mirrorX: true },
    pieceGroups: [
      {
        id: 'front',
        label: '正片',
        order: 0,
        zone: 'body',
        rotation: 180,
        mirrorX: true,
        islandRefs: [{ meshName: 'Cloth_mesh_1' }],
      },
      {
        id: 'back',
        label: '背片',
        order: 1,
        zone: 'body',
        rotation: 180,
        mirrorX: true,
        islandRefs: [{ meshName: 'Cloth_mesh_5' }],
      },
    ],
    appearanceGroups: [
      {
        id: 'body',
        order: 0,
        zone: 'body',
        islandRefs: [
          { meshName: 'Cloth_mesh_1' },
          { meshName: 'Cloth_mesh_5' },
        ],
      },
      {
        id: 'sleeves',
        order: 1,
        zone: 'sleeves',
        islandRefs: [
          { meshName: 'Cloth_mesh' },
          { meshName: 'Cloth_mesh_2' },
          { meshName: 'Cloth_mesh_3' },
          { meshName: 'Cloth_mesh_9' },
          { meshName: 'Cloth_mesh_10' },
          { meshName: 'Cloth_mesh_11' },
        ],
      },
      {
        id: 'shoulderSide',
        order: 2,
        zone: 'shoulderSide',
        islandRefs: [
          { meshName: 'Cloth_mesh_4' },
          { meshName: 'Cloth_mesh_6' },
          { meshName: 'Cloth_mesh_7' },
          { meshName: 'Cloth_mesh_12' },
          { meshName: 'Cloth_mesh_13' },
          { meshName: 'Cloth_mesh_14' },
        ],
      },
      {
        id: 'collar',
        order: 3,
        zone: 'collar',
        islandRefs: [
          { meshName: 'Cloth_mesh_8' },
          { meshName: 'Cloth_mesh_15' },
        ],
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

export function validateModelUvLayout(layout, meshes, { appearanceOnly = false } = {}) {
  if (!isObject(layout)) {
    throwInvalidLayout('配置必须是对象');
  }
  if (!Number.isInteger(layout.version) || layout.version <= 0) {
    throwInvalidLayout('version 版本必须是正整数');
  }
  validatePatternOutputTransform(layout.patternOutputTransform);
  if (!Array.isArray(layout.pieceGroups) || layout.pieceGroups.length === 0) {
    throwInvalidLayout('pieceGroups 裁片组必须是非空数组');
  }

  const ids = validateGroups(layout.pieceGroups, '裁片组', {
    requirePieceFields: !appearanceOnly,
  });
  if (!appearanceOnly && (!ids.has('front') || !ids.has('back'))) {
    throw new Error('模型 UV 裁片配置必须至少包含正片和背片。');
  }

  if (!Array.isArray(meshes)) {
    throw new Error('模型 UV 裁片配置校验失败：网格列表必须是数组。');
  }
  for (const mesh of meshes) {
    if (!isObject(mesh) || !isNonEmptyString(mesh.name)) {
      throw new Error('模型 UV 裁片配置校验失败：网格列表包含无效网格项。');
    }
  }

  const available = new Set();
  for (const mesh of meshes) {
    if (available.has(mesh.name)) {
      throw new Error(`模型 UV 网格名称 "${mesh.name}" 不唯一。`);
    }
    available.add(mesh.name);
  }
  if (!appearanceOnly) {
    for (const group of layout.pieceGroups) {
      for (const island of group.islandRefs) {
        if (!available.has(island.meshName)) {
          throw new Error(`UV 裁片 "${group.id}" 找不到网格 "${island.meshName}"。`);
        }
      }
    }
  }

  const hasAppearanceGroups = layout.appearanceGroups !== undefined;
  const appearanceGroups = layout.appearanceGroups ?? layout.pieceGroups;
  if (hasAppearanceGroups) {
    if (!Array.isArray(layout.appearanceGroups) || layout.appearanceGroups.length === 0) {
      throwInvalidLayout('appearanceGroups 外观组必须是非空数组');
    }
    validateGroups(appearanceGroups, '外观组');
  }
  validateAppearanceCoverage(appearanceGroups, available, {
    appearanceGroups: hasAppearanceGroups,
    requireFullCoverage: hasAppearanceGroups,
  });
  return true;
}

function validatePatternOutputTransform(patternOutputTransform) {
  if (patternOutputTransform === undefined) return;
  if (!isObject(patternOutputTransform)) {
    throwInvalidLayout('patternOutputTransform 必须是对象');
  }
  if (!Number.isFinite(patternOutputTransform.rotation)
    || ![0, 90, 180, 270].includes(patternOutputTransform.rotation)) {
    throwInvalidLayout('patternOutputTransform 的 rotation 必须是 0、90、180 或 270 度');
  }
  if (typeof patternOutputTransform.mirrorX !== 'boolean') {
    throwInvalidLayout('patternOutputTransform 的 mirrorX 必须是 boolean');
  }
}

function validateGroups(groups, groupLabel, { requirePieceFields = false } = {}) {
  const ids = new Set();
  const orders = new Set();
  for (const [index, group] of groups.entries()) {
    if (!isObject(group)) {
      throwInvalidLayout(`第 ${index + 1} 个${groupLabel}必须是对象`);
    }
    if (!isNonEmptyString(group.id)) {
      throwInvalidLayout(`第 ${index + 1} 个${groupLabel}的 id 必须是非空字符串`);
    }
    if (ids.has(group.id)) {
      throwInvalidLayout(`${groupLabel} id "${group.id}" 重复`);
    }
    ids.add(group.id);
    if (requirePieceFields && !isNonEmptyString(group.label)) {
      throwInvalidLayout(`${groupLabel} "${group.id}" 的 label 必须是非空字符串`);
    }
    if (!isNonEmptyString(group.zone)) {
      throwInvalidLayout(`${groupLabel} "${group.id}" 的 zone 必须是非空字符串`);
    }
    if (!APPEARANCE_ZONES.includes(group.zone)) {
      throwInvalidLayout(`${groupLabel} "${group.id}" 的 zone "${group.zone}" 不受支持`);
    }
    if (!Number.isInteger(group.order) || group.order < 0) {
      throwInvalidLayout(`${groupLabel} "${group.id}" 的 order 必须是非负整数`);
    }
    if (orders.has(group.order)) {
      throwInvalidLayout(`${groupLabel} order "${group.order}" 重复`);
    }
    orders.add(group.order);
    if (requirePieceFields) {
      if (!Number.isFinite(group.rotation) || ![0, 90, 180, 270].includes(group.rotation)) {
        throwInvalidLayout(`${groupLabel} "${group.id}" 的 rotation 必须是 0、90、180 或 270 度`);
      }
      if (typeof group.mirrorX !== 'boolean') {
        throwInvalidLayout(`${groupLabel} "${group.id}" 的 mirrorX 必须是 boolean`);
      }
    }
    if (!Array.isArray(group.islandRefs) || group.islandRefs.length === 0) {
      throwInvalidLayout(`${groupLabel} "${group.id}" 的 islandRefs 必须是非空数组`);
    }
    for (const [islandIndex, island] of group.islandRefs.entries()) {
      if (!isObject(island)) {
        throwInvalidLayout(`${groupLabel} "${group.id}" 的第 ${islandIndex + 1} 个 UV 岛引用必须是对象`);
      }
      if (!isNonEmptyString(island.meshName)) {
        throwInvalidLayout(`${groupLabel} "${group.id}" 的 meshName 必须是非空字符串`);
      }
    }
  }
  return ids;
}

function validateAppearanceCoverage(
  groups,
  available,
  { appearanceGroups, requireFullCoverage },
) {
  const ownerByMeshName = new Map();
  for (const group of groups) {
    for (const { meshName } of group.islandRefs) {
      const owner = ownerByMeshName.get(meshName);
      if (owner) {
        if (!appearanceGroups && owner === group.id) {
          throw new Error(`模型 UV 裁片组 "${group.id}" 重复引用网格 "${meshName}"。`);
        }
        const groupLabel = appearanceGroups ? '外观组' : '裁片组';
        throw new Error(`模型 UV 网格 "${meshName}" 被${groupLabel} "${owner}" 和 "${group.id}" 重复引用。`);
      }
      if (!available.has(meshName)) {
        if (!appearanceGroups) {
          throw new Error(`模型 UV 网格 "${meshName}" 不存在。`);
        }
        throw new Error(`UV 外观组 "${group.id}" 找不到网格 "${meshName}"。`);
      }
      ownerByMeshName.set(meshName, group.id);
    }
  }
  if (!requireFullCoverage) return;
  const missing = [...available].filter((meshName) => !ownerByMeshName.has(meshName));
  if (missing.length > 0) {
    throw new Error(`模型 UV 外观组未覆盖网格：${missing.map((name) => `"${name}"`).join('、')}。`);
  }
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
