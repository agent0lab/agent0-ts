import { afterEach, describe, expect, it } from '@jest/globals';

import { IPFSClient } from '../src/core/ipfs-client.js';

describe.skip('IPFSClient (embedded Helia) round-trip', () => {
  let client: IPFSClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = undefined;
    }
  });

  it('can add and get back content without a daemon', async () => {
    client = new IPFSClient({ embeddedHeliaEnabled: true });

    const input = JSON.stringify({ hello: 'world', n: 123 });
    const cid = await client.add(input, 'test.json');

    const output = await client.get(cid);
    expect(output).toBe(input);
  });
});

