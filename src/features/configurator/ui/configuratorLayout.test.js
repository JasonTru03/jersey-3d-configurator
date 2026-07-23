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
    expect(ruleBody(css, '.config-panel')).toContain('overflow-y: auto');
  });

  it('restores document flow at the existing single-column breakpoint', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 1040px)'));
    expect(ruleBody(narrow, '.configurator-shell')).toContain('height: auto');
    expect(ruleBody(narrow, '.configurator-shell')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.workspace-grid')).toContain('overflow: visible');
    expect(ruleBody(narrow, '.stage-wrap')).toContain('min-height: 560px');
    expect(ruleBody(narrow, '.config-panel')).toContain('overflow: visible');
  });
});
