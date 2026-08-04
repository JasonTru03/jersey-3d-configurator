import { describe, expect, it } from 'vitest';
import { IncrementalSha256, sha256ReadableStreamHex } from './incrementalSha256.js';

describe('IncrementalSha256', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('matches the SHA-256 standard vector for %j', (input, expected) => {
    const hash = new IncrementalSha256();
    const bytes = new TextEncoder().encode(input);
    hash.update(bytes.subarray(0, Math.floor(bytes.length / 2)));
    hash.update(bytes.subarray(Math.floor(bytes.length / 2)));

    expect(hash.digestHex()).toBe(expected);
  });

  it('rejects updates after finalization', () => {
    const hash = new IncrementalSha256();
    hash.update(new Uint8Array([1, 2, 3]));
    hash.digestHex();

    expect(() => hash.update(new Uint8Array([4]))).toThrow('SHA-256 has already been finalized.');
    expect(() => hash.digestHex()).toThrow('SHA-256 has already been finalized.');
  });

  it('hashes a Web Stream incrementally without buffering it as a Response', async () => {
    const chunks = ['a', 'b', 'c'].map((value) => new TextEncoder().encode(value));
    const stream = new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });

    await expect(sha256ReadableStreamHex(stream))
      .resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
