export const jerseyProduct = {
  id: 'fn8788-jersey',
  name: 'FN8788 Match Jersey',
  basePrice: 89,
  currency: 'USD',
  renderer: 'garmentRenderer',
  model: {
    glbUrl: '/models/fn8788-jersey.glb',
    assetName: 'fn8788-jersey.glb',
  },
  optionLabels: {
    layout: 'Size',
    colorway: 'Colorway',
    material: 'Fabric',
    lighting: 'Print',
    extras: 'Extras',
  },
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
        swatches: {
          fabric: '#f7f5ef',
          trim: '#20242a',
          accent: '#d8c17a',
          number: '#20242a',
          light: '#efe4bb',
        },
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
