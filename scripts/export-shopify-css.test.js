import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportShopifyCss } from './export-shopify-css.mjs';

let directory;

afterEach(() => {
  if (directory) rmSync(directory, { force: true, recursive: true });
  directory = null;
});

describe('Shopify CSS export', () => {
  it('includes every personalization overlay interaction style from the shared source', () => {
    directory = mkdtempSync(join(tmpdir(), 'pc3d-css-'));
    const output = join(directory, 'product-configurator.css');

    exportShopifyCss({ output });

    const css = readFileSync(output, 'utf8');
    expect(css).toContain('.print-toolbar-overlay');
    expect(css).toContain('.print-selection-frame');
    expect(css).toContain('.print-control-dock');
    expect(css).toContain('grid-template-columns: repeat(var(--print-dock-columns), 44px)');
    expect(css).toContain('.print-control--rotate');
    expect(css).toContain('touch-action: none');
    expect(css).toContain('.print-control--rotate.is-dragging');
    expect(css).toContain('cursor: grabbing');
    expect(css).toContain('.print-control--resize');
    expect(css).toContain('.print-control:disabled');
    expect(css).toContain('cursor: not-allowed');
    expect(css).toContain('var(--pc3d-line, var(--line))');
    expect(css).toContain('var(--pc3d-panel, var(--panel))');
    expect(css).toContain('var(--pc3d-accent, var(--accent))');
    expect(css).toContain('@container stage (max-width: 360px)');
  });
});
