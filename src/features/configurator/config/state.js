export function mergeConfiguratorState(current, patch) {
  const currentAppearance = current.overrides?.appearance;
  const patchAppearance = patch.overrides?.appearance;

  return {
    ...current,
    ...patch,
    extras: {
      ...current.extras,
      ...patch.extras,
    },
    overrides: {
      ...current.overrides,
      ...patch.overrides,
      ...(currentAppearance || patchAppearance ? {
        appearance: {
          ...currentAppearance,
          ...patchAppearance,
          colors: {
            ...currentAppearance?.colors,
            ...patchAppearance?.colors,
          },
        },
      } : {}),
    },
  };
}
