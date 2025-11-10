/**
 * Web3 integration layer for smart contract interactions using ethers.js
 */

import {
  ethers,
  type Contract,
  type Wallet,
  type Signer,
  type JsonRpcProvider,
  type InterfaceAbi,
} from 'ethers';

export interface TransactionOptions {
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/**
 * Web3 client for interacting with ERC-8004 smart contracts
 */
export class Web3Client {
  public readonly provider: JsonRpcProvider;
  public readonly signer?: Wallet | Signer;
  public chainId: bigint;

  /**
   * Initialize Web3 client
   * @param rpcUrl - RPC endpoint URL
   * @param signerOrKey - Optional private key string OR ethers Wallet/Signer for signing transactions
   */
  constructor(rpcUrl: string, signerOrKey?: string | Wallet | Signer) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    if (signerOrKey) {
      if (typeof signerOrKey === 'string') {
        // Private key string - create a new Wallet
        // Validate that it's not an empty string
        if (signerOrKey.trim() === '') {
          throw new Error('Private key cannot be empty');
        }
        this.signer = new ethers.Wallet(signerOrKey, this.provider);
      } else {
        // Already a Wallet or Signer - connect to provider if needed
        const currentProvider = (signerOrKey as any).provider;
        if (currentProvider && currentProvider === this.provider) {
          // Already connected to the same provider
          this.signer = signerOrKey;
        } else if (typeof signerOrKey.connect === 'function') {
          // Connect to provider
          try {
            this.signer = signerOrKey.connect(this.provider);
          } catch (error) {
            throw new Error(`Failed to connect signer to provider: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          // Signer without connect method - use as-is
          this.signer = signerOrKey;
        }
      }
    }

    // Get chain ID asynchronously (will be set in async initialization)
    // For now, we'll fetch it when needed
    this.chainId = 0n;
  }

  /**
   * Initialize the client (fetch chain ID)
   */
  async initialize(): Promise<void> {
    const network = await this.provider.getNetwork();
    this.chainId = network.chainId;
  }

  /**
   * Get contract instance
   */
  getContract(address: string, abi: InterfaceAbi): Contract {
    const signerOrProvider = this.signer || this.provider;
    return new ethers.Contract(address, abi, signerOrProvider);
  }

  /**
   * Call a contract method (view/pure function)
   */
  async callContract(
    contract: Contract,
    methodName: string,
    ...args: any[]
  ): Promise<any> {
    const method = contract[methodName];
    if (!method || typeof method !== 'function') {
      throw new Error(`Method ${methodName} not found on contract`);
    }
    return await method(...args);
  }

  /**
   * Execute a contract transaction
   * For overloaded functions like register(), use registerAgent() wrapper instead
   */
  async transactContract(
    contract: Contract,
    methodName: string,
    options: TransactionOptions = {},
    ...args: any[]
  ): Promise<string> {
    if (!this.signer) {
      throw new Error(
        'Cannot execute transaction: SDK is in read-only mode. Provide a private key to enable write operations.'
      );
    }

    // Special handling for register() function with multiple overloads
    if (methodName === 'register') {
      return this.registerAgent(contract, options, ...args);
    }

    const method = contract[methodName];
    if (!method || typeof method !== 'function') {
      throw new Error(`Method ${methodName} not found on contract`);
    }

    // Build transaction options - filter out undefined values
    const txOptions = Object.fromEntries(
      Object.entries(options).filter(([_, value]) => value !== undefined)
    ) as Partial<TransactionOptions>;

    // Send transaction
    const tx = await method(...args);
    const txResponse = await tx;
    return txResponse.hash;
  }

  /**
   * Router wrapper for register() function overloads
   * Intelligently selects the correct overload based on arguments:
   * - register() - no arguments
   * - register(string tokenUri) - just tokenUri
   * - register(string tokenUri, tuple[] metadata) - tokenUri + metadata
   */
  private async registerAgent(
    contract: Contract,
    options: TransactionOptions,
    ...args: any[]
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('No signer available for transaction');
    }

    const contractInterface = contract.interface;

    // Determine which overload to use based on arguments
    let functionName: string;
    let callArgs: any[];

    if (args.length === 0) {
      // register() - no arguments
      functionName = 'register()';
      callArgs = [];
    } else if (args.length === 1 && typeof args[0] === 'string') {
      // register(string tokenUri) - just tokenUri
      functionName = 'register(string)';
      callArgs = [args[0]];
    } else if (args.length === 2 && typeof args[0] === 'string' && Array.isArray(args[1])) {
      // register(string tokenUri, tuple[] metadata) - tokenUri + metadata
      functionName = 'register(string,(string,bytes)[])';
      callArgs = [args[0], args[1]];
    } else {
      throw new Error(
        `Invalid arguments for register(). Expected: () | (string) | (string, tuple[]), got ${args.length} arguments`
      );
    }

    // Get the specific function fragment using the signature
    const functionFragment = contractInterface.getFunction(functionName);
    if (!functionFragment) {
      throw new Error(`Function ${functionName} not found in contract ABI`);
    }

    // Encode function data to avoid ambiguity - this bypasses function resolution
    const data = contractInterface.encodeFunctionData(functionFragment, callArgs);
    
    // Send transaction directly with encoded data (no function call resolution needed)
    const txResponse = await this.signer.sendTransaction({
      to: contract.target as string,
      data: data,
    });
    
    return txResponse.hash;
  }

  /**
   * Wait for transaction to be mined
   */
  async waitForTransaction(
    txHash: string,
    timeout: number = 60000
  ): Promise<ethers.ContractTransactionReceipt> {
    return (await this.provider.waitForTransaction(txHash, undefined, timeout)) as ethers.ContractTransactionReceipt;
  }

  /**
   * Get contract events
   */
  async getEvents(
    contract: Contract,
    eventName: string,
    fromBlock: number = 0,
    toBlock?: number
  ): Promise<ethers.Log[]> {
    const filter = contract.filters[eventName]();
    return await contract.queryFilter(filter, fromBlock, toBlock);
  }

  /**
   * Encode feedback authorization data
   */
  encodeFeedbackAuth(
    agentId: bigint,
    clientAddress: string,
    indexLimit: bigint,
    expiry: bigint,
    chainId: bigint,
    identityRegistry: string,
    signerAddress: string
  ): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
      [agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerAddress]
    );
  }

  /**
   * Sign a message with the account's private key
   */
  async signMessage(message: string | Uint8Array): Promise<string> {
    if (!this.signer) {
      throw new Error('No signer available');
    }
    return await this.signer.signMessage(message);
  }

  /**
   * Recover address from message and signature
   */
  recoverAddress(message: string | Uint8Array, signature: string): string {
    return ethers.verifyMessage(message, signature);
  }

  /**
   * Compute Keccak-256 hash
   */
  keccak256(data: string | Uint8Array): string {
    if (typeof data === 'string') {
      return ethers.keccak256(ethers.toUtf8Bytes(data));
    }
    // For Uint8Array, convert to hex string first
    return ethers.keccak256(ethers.hexlify(data));
  }

  /**
   * Convert address to checksum format
   */
  toChecksumAddress(address: string): string {
    return ethers.getAddress(address);
  }


  /**
   * Check if string is a valid Ethereum address
   */
  isAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  /**
   * Get ETH balance of an address
   */
  async getBalance(address: string): Promise<bigint> {
    return await this.provider.getBalance(address);
  }

  /**
   * Get transaction count (nonce) of an address
   */
  async getTransactionCount(address: string): Promise<number> {
    return await this.provider.getTransactionCount(address, 'pending');
  }

  /**
   * Get the account address (if signer is available)
   */
  get address(): string | undefined {
    if (!this.signer) return undefined;
    // Wallet has address property, Signer might need getAddress()
    if ('address' in this.signer) {
      return this.signer.address as string;
    }
    // For generic Signer, we can't get address synchronously
    // This is a limitation of the Signer interface
    return undefined;
  }
  
  /**
   * Get the account address asynchronously (if signer is available)
   * Use this method when you need the address from a generic Signer
   */
  async getAddress(): Promise<string | undefined> {
    if (!this.signer) return undefined;
    return await this.signer.getAddress();
  }
}

