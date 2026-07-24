import { APPEARANCE_TEMPLATES, normalizeAppearance } from './appearance.js';
import { createDefaultBottomPattern } from './bottomPattern.js';

const homeSwatches = {
  fabric: '#f7f5ef',
  trim: '#20242a',
  accent: '#d8c17a',
  number: '#20242a',
  light: '#efe4bb',
};

export const jerseyProduct = {
  id: 'fn8788-jersey',
  name: 'Chelsea Match Jersey',
  basePrice: 89,
  currency: 'USD',
  renderer: 'garmentRenderer',
  model: {
    glbUrl: '/models/chelsea-jersey.glb',
    assetName: 'chelsea-jersey.glb',
  },
  optionLabels: {
    layout: 'Size',
    design: 'Design',
    material: 'Fabric',
    personalize: 'Personalize',
    decorations: 'Artwork',
    extras: 'Extras',
  },
  decorationPresets: [
    {
      id: 'crest-badge',
      kind: 'badge',
      label: 'Crest Badge',
      source: 'crest-badge',
      assetUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140"%3E%3Cpath fill="%231f5b4f" stroke="%23d1b05d" stroke-width="8" d="M60 5 110 25v48c0 31-20 51-50 62C30 124 10 104 10 73V25z"/%3E%3Cpath fill="%23f4efe4" d="M60 31 70 55l26 2-20 17 6 26-22-13-22 13 6-26-20-17 26-2z"/%3E%3C/svg%3E',
    },
    {
      id: 'roundel-badge',
      kind: 'badge',
      label: 'Roundel Badge',
      source: 'roundel-badge',
      assetUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140"%3E%3Ccircle cx="70" cy="70" r="64" fill="%23c84f3d" stroke="%23f4efe4" stroke-width="10"/%3E%3Ccircle cx="70" cy="70" r="35" fill="%2320242a"/%3E%3Cpath fill="%23f4efe4" d="m70 39 9 22 24 2-18 16 6 24-21-13-21 13 6-24-18-16 24-2z"/%3E%3C/svg%3E',
    },
  ],
  defaultState: {
    productId: 'fn8788-jersey',
    layout: 'm',
    colorway: 'home',
    material: 'stadium',
    lighting: 'none',
    extras: {
      sleeveBadge: false,
      giftBox: false,
      matchPatch: false,
    },
    overrides: {
      printName: 'PLAYER',
      printNumber: '16',
      printPlacement: {
        x: 0,
        y: 0.36,
        z: 0.5,
      },
      printItems: [
        {
          id: 'print-1',
          name: 'PLAYER',
          number: '16',
          placement: { x: 0, y: 0.36, z: 0.5 },
          scale: 1,
          rotation: 0,
        },
      ],
      customTextItems: [],
      decorations: [],
      appearance: normalizeAppearance(undefined, homeSwatches),
      bottomPattern: createDefaultBottomPattern(),
    },
  },
  options: {
    layout: [
      {
        id: 's',
        label: 'Small',
        shortLabel: 'S',
        description: 'Slim fit for chest 35-37 in.',
        priceDelta: 0,
      },
      {
        id: 'm',
        label: 'Medium',
        shortLabel: 'M',
        description: 'Regular fit for chest 38-40 in.',
        priceDelta: 0,
      },
      {
        id: 'l',
        label: 'Large',
        shortLabel: 'L',
        description: 'Regular fit for chest 41-43 in.',
        priceDelta: 0,
      },
      {
        id: 'xl',
        label: 'Extra Large',
        shortLabel: 'XL',
        description: 'Roomier fit for chest 44-46 in.',
        priceDelta: 4,
      },
    ],
    colorway: [
      {
        id: 'home',
        label: 'Home White',
        description: 'Clean white body with black trim.',
        priceDelta: 0,
        swatches: homeSwatches,
      },
      {
        id: 'away',
        label: 'Away Black',
        description: 'Black base with ivory details.',
        priceDelta: 0,
        swatches: {
          fabric: '#20242a',
          trim: '#f4efe4',
          accent: '#c84f3d',
          number: '#f4efe4',
          light: '#f0ad82',
        },
      },
      {
        id: 'third',
        label: 'Third Green',
        description: 'Deep green shirt with gold accents.',
        priceDelta: 0,
        swatches: {
          fabric: '#1f5b4f',
          trim: '#f4efe4',
          accent: '#d1b05d',
          number: '#f4efe4',
          light: '#85d2b8',
        },
      },
    ],
    templates: APPEARANCE_TEMPLATES,
    material: [
      {
        id: 'stadium',
        label: 'Stadium recycled knit',
        shortLabel: 'Stadium knit',
        priceDelta: 0,
        material: { roughness: 0.74, metalness: 0 },
      },
      {
        id: 'player',
        label: 'Player issue performance mesh',
        shortLabel: 'Player mesh',
        priceDelta: 24,
        material: { roughness: 0.56, metalness: 0 },
      },
      {
        id: 'long-sleeve',
        label: 'Long sleeve winter cut',
        shortLabel: 'Long sleeve',
        priceDelta: 18,
        material: { roughness: 0.68, metalness: 0 },
      },
    ],
    lighting: [
      {
        id: 'none',
        label: 'No personalization',
        shortLabel: 'None',
        priceDelta: 0,
      },
      {
        id: 'name-number',
        label: 'Name and number set',
        shortLabel: 'Name set',
        priceDelta: 18,
      },
      {
        id: 'raised-print',
        label: 'Raised player print',
        shortLabel: 'Raised print',
        priceDelta: 26,
      },
    ],
    extras: [
      {
        id: 'sleeveBadge',
        label: 'League sleeve badge',
        priceDelta: 10,
      },
      {
        id: 'matchPatch',
        label: 'Match day chest patch',
        priceDelta: 12,
      },
      {
        id: 'giftBox',
        label: 'Collector gift box',
        priceDelta: 8,
      },
    ],
  },
};

export const products = [jerseyProduct];
