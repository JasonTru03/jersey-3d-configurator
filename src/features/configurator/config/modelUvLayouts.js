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
  if (!layout || !Number.isInteger(layout.version) || !Array.isArray(layout.pieceGroups)) {
    throw new Error('模型 UV 裁片配置缺少可用的版本或裁片组。');
  }

  const ids = new Set(layout.pieceGroups.map(({ id }) => id));
  if (!ids.has('front') || !ids.has('back')) {
    throw new Error('模型 UV 裁片配置必须至少包含正片和背片。');
  }

  const available = new Set((meshes ?? []).map((mesh) => mesh.name));
  for (const group of layout.pieceGroups) {
    if (typeof group.id !== 'string' || !group.id || !Array.isArray(group.islandRefs)
      || group.islandRefs.length === 0) {
      throw new Error(`UV 裁片组 "${group.id ?? '未命名'}" 缺少可用的 UV 岛引用。`);
    }
    for (const island of group.islandRefs) {
      if (typeof island.meshName !== 'string' || !island.meshName) {
        throw new Error(`UV 裁片 "${group.id}" 缺少可用的网格名。`);
      }
      if (!available.has(island.meshName)) {
        throw new Error(`UV 裁片 "${group.id}" 找不到网格 "${island.meshName}"。`);
      }
    }
  }
  return true;
}
