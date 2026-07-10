export function mergeConfiguratorState(current, patch) {
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
    },
  };
}
