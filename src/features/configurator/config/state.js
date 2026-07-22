export function mergeConfiguratorState(current, patch) {
  const currentAppearance = current.overrides?.appearance;
  const patchAppearance = patch.overrides?.appearance;
  const currentBottomPattern = current.overrides?.bottomPattern;
  const patchBottomPattern = patch.overrides?.bottomPattern;

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
      ...(currentBottomPattern || patchBottomPattern ? {
        bottomPattern: {
          ...currentBottomPattern,
          ...patchBottomPattern,
          transform: {
            ...currentBottomPattern?.transform,
            ...patchBottomPattern?.transform,
            offset: {
              ...currentBottomPattern?.transform?.offset,
              ...patchBottomPattern?.transform?.offset,
            },
            repeat: {
              ...currentBottomPattern?.transform?.repeat,
              ...patchBottomPattern?.transform?.repeat,
            },
          },
        },
      } : {}),
    },
  };
}
