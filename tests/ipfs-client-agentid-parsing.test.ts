import { IPFSClient } from '../src/core/ipfs-client';
import type { RegistrationFile } from '../src/models/interfaces';

function makeBaseRegistrationFile(overrides: Partial<RegistrationFile> = {}): RegistrationFile {
  return {
    name: 'Test Agent',
    description: 'Test Description',
    endpoints: [],
    trustModels: [],
    owners: [],
    operators: [],
    active: true,
    x402support: false,
    metadata: {},
    updatedAt: 0,
    ...overrides,
  };
}

describe('IPFSClient.addRegistrationFile agentId parsing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('supports internal AgentId format "chainId:tokenId"', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'test-jwt' });

    const addJsonSpy = jest
      .spyOn(IPFSClient.prototype as unknown as { addJson: (data: any) => Promise<string> }, 'addJson')
      .mockImplementation(async (data: any) => {
        expect(data.registrations).toEqual([
          { agentId: 375, agentRegistry: 'eip155:11155111:0x000000000000000000000000000000000000dEaD' },
        ]);
        return 'cid';
      });

    const rf = makeBaseRegistrationFile({ agentId: '11155111:375' });
    const cid = await client.addRegistrationFile(rf, 11155111, '0x000000000000000000000000000000000000dEaD');
    expect(cid).toBe('cid');
    expect(addJsonSpy).toHaveBeenCalledTimes(1);
  });

  it('supports CAIP-style AgentId format "eip155:chainId:tokenId"', async () => {
    const client = new IPFSClient({ pinataEnabled: true, pinataJwt: 'test-jwt' });

    const addJsonSpy = jest
      .spyOn(IPFSClient.prototype as unknown as { addJson: (data: any) => Promise<string> }, 'addJson')
      .mockImplementation(async (data: any) => {
        expect(data.registrations).toEqual([
          { agentId: 375, agentRegistry: 'eip155:11155111:0x000000000000000000000000000000000000dEaD' },
        ]);
        return 'cid';
      });

    const rf = makeBaseRegistrationFile({ agentId: 'eip155:11155111:375' });
    const cid = await client.addRegistrationFile(rf, 11155111, '0x000000000000000000000000000000000000dEaD');
    expect(cid).toBe('cid');
    expect(addJsonSpy).toHaveBeenCalledTimes(1);
  });
});


