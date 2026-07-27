import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeQuoteComponents,
  verifyQuoteContract,
} from './quoteContract.js';

const fixturePath = resolve(
  process.cwd(),
  'shopify-app/extensions/secure-jersey-transform/tests/fixtures/valid-two-component.json',
);

describe('Rust Cart Transform golden quote fixture', () => {
  it('stays byte-compatible with the JavaScript signing contract', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
    const lines = fixture.cart.lines;
    const token = lines[0].quote.value;
    const components = lines.map((line) => ({
      role: line.component.value,
      variantId: line.merchandise.id.split('/').at(-1),
      quantity: line.quantity,
    }));
    const config = fixture.cartTransform.config.jsonValue;

    await expect(verifyQuoteContract(token, components, config.signingSecret, {
      now: Date.parse('2026-07-27T00:00:00Z'),
      expectedShopFingerprint: config.shopFingerprint,
    })).resolves.toMatchObject({
      bundleId: lines[0].bundleId.value,
      designId: lines[0].designId.value,
      totalMinor: 10700,
      currency: 'USD',
    });
    expect(canonicalizeQuoteComponents(components).map((component) => [
      component.role === 'base' ? 'b' : 's',
      component.variantId,
      component.quantity,
    ])).toEqual([
      ['b', '111', 1],
      ['s', '222', 1],
    ]);
  });
});
