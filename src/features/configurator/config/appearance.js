export const APPEARANCE_TEXTURE_VERSION = 1;

export const APPEARANCE_ZONES = [
  'body',
  'sleeves',
  'shoulderSide',
  'collar',
  'pattern',
  'number',
];

export const APPEARANCE_TEMPLATES = [
  { id: 'solid', label: 'Solid' },
  { id: 'vertical-stripes', label: 'Vertical Stripes' },
  { id: 'horizontal-stripes', label: 'Horizontal Stripes' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'color-block', label: 'Color Block' },
];

export const APPEARANCE_PALETTE = [
  '#F7F5EF', '#20242A', '#1F5B4F', '#F4EFE4', '#D1B05D', '#C84F3D',
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const TEMPLATE_IDS = new Set(APPEARANCE_TEMPLATES.map((template) => template.id));

export function normalizeAppearance(appearance = {}, legacySwatches = {}) {
  const colors = appearance?.colors ?? {};
  const resolvedColors = Object.fromEntries(APPEARANCE_ZONES.map((zone) => [
    zone,
    normalizeColor(colors[zone], legacyColorForZone(zone, legacySwatches), zone),
  ]));

  return {
    template: TEMPLATE_IDS.has(appearance?.template) ? appearance.template : 'solid',
    colors: resolvedColors,
  };
}

function legacyColorForZone(zone, swatches) {
  switch (zone) {
    case 'body':
    case 'sleeves':
      return swatches.fabric;
    case 'shoulderSide':
    case 'collar':
      return swatches.trim ?? swatches.accent;
    case 'pattern':
      return swatches.accent ?? swatches.trim;
    case 'number':
      return swatches.number ?? swatches.trim;
    default:
      return undefined;
  }
}

function normalizeColor(explicitColor, fallbackColor, zone) {
  if (explicitColor !== undefined && !HEX_COLOR.test(explicitColor)) {
    throw new Error(`Appearance color ${zone} must be a six-digit hex color.`);
  }

  if (fallbackColor !== undefined && !HEX_COLOR.test(fallbackColor)) {
    return APPEARANCE_PALETTE[0];
  }

  return (explicitColor ?? fallbackColor ?? APPEARANCE_PALETTE[0]).toUpperCase();
}
