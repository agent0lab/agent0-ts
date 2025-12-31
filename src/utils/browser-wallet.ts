/**
 * Browser Wallet Utilities for Frontend Applications
 * 
 * This module provides helper functions to connect to browser wallets like MetaMask,
 * Coinbase Wallet, WalletConnect, and other EIP-1193 compatible wallets.
 */

import { ethers, type BrowserProvider, type Signer } from 'ethers';

/**
 * EIP-1193 compatible provider interface (window.ethereum)
 */
export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isWalletConnect?: boolean;
}

/**
 * Result from connecting to a browser wallet
 */
export interface BrowserWalletConnection {
  provider: BrowserProvider;
  signer: Signer;
  address: string;
  chainId: number;
}

/**
 * Options for connecting to a browser wallet
 */
export interface ConnectWalletOptions {
  /**
   * Target chain ID to switch to after connecting
   * If not specified, uses the wallet's current chain
   */
  targetChainId?: number;
  /**
   * Whether to request account access (default: true)
   */
  requestAccounts?: boolean;
}

/**
 * Check if we're in a browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Get the EIP-1193 provider from window.ethereum
 * @returns The ethereum provider or null if not available
 */
export function getEthereumProvider(): EIP1193Provider | null {
  if (!isBrowser()) {
    return null;
  }
  
  // Access window.ethereum with type safety
  const win = window as Window & { ethereum?: EIP1193Provider };
  return win.ethereum || null;
}

/**
 * Check if a browser wallet is available
 * @returns true if a wallet provider is detected
 */
export function isWalletAvailable(): boolean {
  return getEthereumProvider() !== null;
}

/**
 * Detect the type of browser wallet
 * @returns The detected wallet type or 'unknown'
 */
export function detectWalletType(): 'metamask' | 'coinbase' | 'walletconnect' | 'unknown' | 'none' {
  const provider = getEthereumProvider();
  
  if (!provider) {
    return 'none';
  }
  
  if (provider.isMetaMask) {
    return 'metamask';
  }
  
  if (provider.isCoinbaseWallet) {
    return 'coinbase';
  }
  
  if (provider.isWalletConnect) {
    return 'walletconnect';
  }
  
  return 'unknown';
}

/**
 * Connect to a browser wallet (MetaMask, Coinbase Wallet, etc.)
 * 
 * @example
 * // Basic usage
 * const { provider, signer, address, chainId } = await connectBrowserWallet();
 * 
 * // With target chain
 * const { provider, signer, address, chainId } = await connectBrowserWallet({ targetChainId: 11155111 });
 * 
 * @param options - Connection options
 * @returns Connected wallet information
 * @throws Error if no wallet is available or user rejects connection
 */
export async function connectBrowserWallet(
  options: ConnectWalletOptions = {}
): Promise<BrowserWalletConnection> {
  const { targetChainId, requestAccounts = true } = options;
  
  const ethereumProvider = getEthereumProvider();
  
  if (!ethereumProvider) {
    throw new Error(
      'No browser wallet detected. Please install MetaMask or another Web3 wallet.'
    );
  }
  
  // Create BrowserProvider
  const provider = new ethers.BrowserProvider(ethereumProvider);
  
  // Request account access if needed
  if (requestAccounts) {
    try {
      await ethereumProvider.request({ method: 'eth_requestAccounts' });
    } catch (error) {
      const err = error as { code?: number; message?: string };
      if (err.code === 4001) {
        throw new Error('User rejected the connection request');
      }
      throw new Error(`Failed to connect wallet: ${err.message || 'Unknown error'}`);
    }
  }
  
  // Get signer
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  
  // Get current chain ID
  const network = await provider.getNetwork();
  let chainId = Number(network.chainId);
  
  // Switch chain if requested
  if (targetChainId && chainId !== targetChainId) {
    try {
      await switchChain(ethereumProvider, targetChainId);
      chainId = targetChainId;
    } catch (error) {
      console.warn(`Could not switch to chain ${targetChainId}:`, error);
      // Continue with current chain
    }
  }
  
  return {
    provider,
    signer,
    address,
    chainId,
  };
}

/**
 * Request to switch the wallet to a different chain
 * 
 * @param ethereumProvider - The EIP-1193 provider
 * @param chainId - The target chain ID
 * @throws Error if chain switch fails
 */
export async function switchChain(
  ethereumProvider: EIP1193Provider,
  chainId: number
): Promise<void> {
  const chainIdHex = `0x${chainId.toString(16)}`;
  
  try {
    await ethereumProvider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    const err = error as { code?: number; message?: string };
    // Error code 4902: Chain not added to wallet
    if (err.code === 4902) {
      throw new Error(
        `Chain ${chainId} is not configured in your wallet. Please add it manually.`
      );
    }
    throw new Error(`Failed to switch chain: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Add a chain to the wallet (for networks not already configured)
 * 
 * @param ethereumProvider - The EIP-1193 provider
 * @param chainConfig - Chain configuration
 */
export async function addChain(
  ethereumProvider: EIP1193Provider,
  chainConfig: {
    chainId: number;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    blockExplorerUrls?: string[];
  }
): Promise<void> {
  const chainIdHex = `0x${chainConfig.chainId.toString(16)}`;
  
  await ethereumProvider.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: chainIdHex,
      chainName: chainConfig.chainName,
      rpcUrls: chainConfig.rpcUrls,
      nativeCurrency: chainConfig.nativeCurrency,
      blockExplorerUrls: chainConfig.blockExplorerUrls,
    }],
  });
}

/**
 * Set up event listeners for wallet events
 * 
 * @example
 * const cleanup = setupWalletListeners({
 *   onAccountsChanged: (accounts) => console.log('Accounts changed:', accounts),
 *   onChainChanged: (chainId) => console.log('Chain changed:', chainId),
 *   onDisconnect: () => console.log('Wallet disconnected'),
 * });
 * 
 * // Later, to remove listeners:
 * cleanup();
 * 
 * @param listeners - Event listener callbacks
 * @returns Cleanup function to remove all listeners
 */
export function setupWalletListeners(listeners: {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainId: number) => void;
  onDisconnect?: () => void;
}): () => void {
  const ethereumProvider = getEthereumProvider();
  
  if (!ethereumProvider || !ethereumProvider.on) {
    return () => {}; // No-op cleanup
  }
  
  const accountsHandler = (accounts: unknown) => {
    if (listeners.onAccountsChanged) {
      listeners.onAccountsChanged(accounts as string[]);
    }
  };
  
  const chainHandler = (chainIdHex: unknown) => {
    if (listeners.onChainChanged) {
      const chainId = parseInt(chainIdHex as string, 16);
      listeners.onChainChanged(chainId);
    }
  };
  
  const disconnectHandler = () => {
    if (listeners.onDisconnect) {
      listeners.onDisconnect();
    }
  };
  
  // Add listeners
  ethereumProvider.on('accountsChanged', accountsHandler);
  ethereumProvider.on('chainChanged', chainHandler);
  ethereumProvider.on('disconnect', disconnectHandler);
  
  // Return cleanup function
  return () => {
    if (ethereumProvider.removeListener) {
      ethereumProvider.removeListener('accountsChanged', accountsHandler);
      ethereumProvider.removeListener('chainChanged', chainHandler);
      ethereumProvider.removeListener('disconnect', disconnectHandler);
    }
  };
}

/**
 * Get connected accounts without requesting access
 * @returns Array of connected account addresses, or empty array if none
 */
export async function getConnectedAccounts(): Promise<string[]> {
  const ethereumProvider = getEthereumProvider();
  
  if (!ethereumProvider) {
    return [];
  }
  
  try {
    const accounts = await ethereumProvider.request({ method: 'eth_accounts' }) as string[];
    return accounts || [];
  } catch {
    return [];
  }
}

/**
 * Check if the wallet is already connected
 * @returns true if at least one account is connected
 */
export async function isWalletConnected(): Promise<boolean> {
  const accounts = await getConnectedAccounts();
  return accounts.length > 0;
}

/**
 * Disconnect from the wallet (if supported)
 * Note: Not all wallets support programmatic disconnect
 */
export async function disconnectWallet(): Promise<void> {
  const ethereumProvider = getEthereumProvider();
  
  if (!ethereumProvider) {
    return;
  }
  
  // Try wallet_disconnect if available (used by WalletConnect)
  try {
    await ethereumProvider.request({ method: 'wallet_disconnect' });
  } catch {
    // wallet_disconnect not supported by this wallet
    // User will need to disconnect manually from the wallet extension
  }
}

/**
 * Sign a message using the connected wallet
 * 
 * @param signer - The ethers Signer from the connected wallet
 * @param message - The message to sign
 * @returns The signature
 */
export async function signMessage(signer: Signer, message: string): Promise<string> {
  return await signer.signMessage(message);
}

/**
 * Sign typed data (EIP-712) using the connected wallet
 * 
 * @param signer - The ethers Signer from the connected wallet
 * @param domain - EIP-712 domain
 * @param types - EIP-712 types
 * @param value - The data to sign
 * @returns The signature
 */
export async function signTypedData(
  signer: Signer,
  domain: ethers.TypedDataDomain,
  types: Record<string, ethers.TypedDataField[]>,
  value: Record<string, unknown>
): Promise<string> {
  return await signer.signTypedData(domain, types, value);
}

