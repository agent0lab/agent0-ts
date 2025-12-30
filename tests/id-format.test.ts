import { parseAgentId } from '../src/utils/id-format';

describe('id-format', () => {
  it('parses internal AgentId format "chainId:tokenId"', () => {
    expect(parseAgentId('11155111:375')).toEqual({ chainId: 11155111, tokenId: 375 });
  });

  it('rejects CAIP-style "eip155:chainId:tokenId" (handled elsewhere)', () => {
    expect(() => parseAgentId('eip155:11155111:375')).toThrow();
  });
});


