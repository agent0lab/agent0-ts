/**
 * Enums for Agent0 SDK
 */

/**
 * Types of endpoints that agents can advertise
 */
export enum EndpointType {
  MCP = 'MCP',
  A2A = 'A2A',
  ENS = 'ENS',
  DID = 'DID',
  WALLET = 'wallet',
  OASF = 'OASF',
}

/**
 * Trust models supported by the SDK
 */
export enum TrustModel {
  REPUTATION = 'reputation',
  CRYPTO_ECONOMIC = 'crypto-economic',
  TEE_ATTESTATION = 'tee-attestation',
}

