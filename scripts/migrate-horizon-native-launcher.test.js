import { describe, expect, it } from 'vitest';
import {
  NATIVE_LAUNCHER_BLOCK_ID,
  migrateHorizonTemplate,
} from './migrate-horizon-native-launcher.mjs';

function createTemplate() {
  return {
    sections: {
      main: {
        type: 'product-information',
        blocks: {
          'product-details': {
            type: '_product-details',
            blocks: {
              heading: { type: 'text', settings: { text: 'Title' } },
              picker_1: { type: 'variant-picker', settings: {} },
              buy_1: { type: 'buy-buttons', settings: {} },
              description: { type: 'text', settings: { text: 'Description' } },
            },
            block_order: ['heading', 'picker_1', 'buy_1', 'description'],
          },
        },
      },
      product_3d_configurator_launch: {
        type: 'product-3d-configurator-launch',
        settings: { enabled: true, button_label: 'Start 3D customization' },
      },
      recommendations: { type: 'product-recommendations', settings: {} },
    },
    order: ['main', 'product_3d_configurator_launch', 'recommendations'],
  };
}

describe('migrateHorizonTemplate', () => {
  it('moves the launcher between the native variant picker and buy buttons', () => {
    const result = migrateHorizonTemplate(createTemplate());
    const details = result.sections.main.blocks['product-details'];

    expect(details.blocks[NATIVE_LAUNCHER_BLOCK_ID]).toEqual({
      type: 'product-3d-configurator-launch',
      settings: {
        button_label: 'Start 3D customization',
        enabled: true,
      },
    });
    expect(details.block_order).toEqual([
      'heading',
      'picker_1',
      NATIVE_LAUNCHER_BLOCK_ID,
      'buy_1',
      'description',
    ]);
    expect(result.sections).not.toHaveProperty('product_3d_configurator_launch');
    expect(result.order).toEqual(['main', 'recommendations']);
  });

  it('is idempotent and preserves unrelated template content', () => {
    const once = migrateHorizonTemplate(createTemplate());
    const twice = migrateHorizonTemplate(once);

    expect(twice).toEqual(once);
    expect(twice.sections.recommendations).toEqual({
      type: 'product-recommendations',
      settings: {},
    });
  });

  it('stops when the live Horizon anchor blocks are missing or misordered', () => {
    const missingPicker = createTemplate();
    delete missingPicker.sections.main.blocks['product-details'].blocks.picker_1;

    expect(() => migrateHorizonTemplate(missingPicker))
      .toThrow('The Horizon variant picker and buy buttons are required.');

    const misordered = createTemplate();
    misordered.sections.main.blocks['product-details'].block_order = ['buy_1', 'picker_1'];

    expect(() => migrateHorizonTemplate(misordered))
      .toThrow('The Horizon variant picker must appear before buy buttons.');
  });
});
