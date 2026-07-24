import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/configurator/ui/configurator.css'),
  'utf8',
);

function ruleBody(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule: ${selector}`);
  return match[1].replace(/\s+/g, ' ');
}

describe('wide configurator viewport layout', () => {
  it('keeps the stage in one viewport and gives overflow to the right panel', () => {
    expect(ruleBody(css, '.configurator-shell')).toContain('height: 100dvh');
    expect(ruleBody(css, '.configurator-shell')).toContain('overflow: hidden');
    expect(ruleBody(css, '.workspace')).toContain('min-height: 0');
    expect(ruleBody(css, '.workspace')).toContain('overflow: hidden');
    expect(ruleBody(css, '.workspace-grid')).toContain('overflow: hidden');
    expect(ruleBody(css, '.stage-wrap')).toContain('min-height: 0');
    expect(ruleBody(css, '.config-panel')).toContain('overflow: hidden');
  });

  it('keeps the panel header and checkout footer outside the scroll region', () => {
    expect(ruleBody(css, '.panel-header')).toContain('flex: 0 0 auto');
    expect(ruleBody(css, '.panel-scroll')).toContain('flex: 1 1 auto');
    expect(ruleBody(css, '.panel-scroll')).toContain('overflow-y: auto');
    expect(ruleBody(css, '.panel-scroll')).toContain('overflow-x: hidden');
    expect(ruleBody(css, '.panel-scroll')).toContain('min-height: 0');
    expect(ruleBody(css, '.panel-checkout')).toContain('flex: 0 0 auto');
    expect(ruleBody(css, '.panel-checkout .primary-button')).toContain('min-height: 44px');
  });

  it('keeps status content in a collapsible row above the main workspace', () => {
    expect(ruleBody(css, '.app-shell')).toContain('grid-template-rows: auto auto minmax(0, 1fr)');
    expect(ruleBody(css, '.workspace-status')).toContain('grid-row: 2');
    expect(ruleBody(css, '.workspace-grid')).toContain('grid-row: 3');
  });

  it('keeps the detailed review inside the viewport with internal scrolling', () => {
    expect(ruleBody(css, '.review-dialog')).toContain('max-height: calc(100dvh - 40px)');
    expect(ruleBody(css, '.review-dialog')).toContain('overflow-y: auto');
  });

  it('restores document flow at the existing single-column breakpoint', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1040px)'));
    expect(ruleBody(narrow, '.configurator-shell')).toContain('height: auto');
    expect(ruleBody(narrow, '.configurator-shell')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace-grid')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.stage-wrap')).toContain('min-height: 560px');
    expect(ruleBody(narrow, '.config-panel')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.panel-scroll')).toContain('flex: 0 0 auto');
    expect(ruleBody(narrow, '.panel-scroll')).toContain('overflow: visible');
  });

  it('lays out all six mobile navigation items as two complete rows', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(ruleBody(mobile, '.side-nav')).toContain('grid-template-columns: repeat(3, 1fr)');
  });

  it('keeps personalization actions in a touch-friendly horizontal dock while resize stays on the frame', () => {
    expect(ruleBody(css, '.print-toolbar-overlay')).toContain('pointer-events: none');
    expect(ruleBody(css, '.print-control-dock')).toContain('display: flex');
    expect(ruleBody(css, '.print-control-dock')).toContain('pointer-events: none');
    expect(ruleBody(css, '.print-control')).toContain('width: 44px');
    expect(ruleBody(css, '.print-control')).toContain('height: 44px');
    expect(ruleBody(css, '.print-control')).toContain('pointer-events: auto');
    expect(ruleBody(css, '.print-control--rotate')).toContain('touch-action: none');
    expect(ruleBody(css, '.print-control--rotate')).toContain('cursor: grab');
    expect(ruleBody(css, '.print-control--rotate.is-dragging')).toContain('cursor: grabbing');
    expect(ruleBody(css, '.print-control--resize')).toContain('top: calc(var(--print-top) + var(--print-height) - 22px)');
  });
});
