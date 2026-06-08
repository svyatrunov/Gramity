/** Supported EVM source chains for cross-chain deposit */

export type EvmChainKey = "ethereum" | "base" | "bnb" | "polygon";

export interface ChainConfig {
  key: EvmChainKey;
  chainId: number;
  label: string;
  omnistonCase: EvmChainKey;
  explorerTx: string;
  nativeSymbol: string;
  rpcUrl: string;
  blockExplorerUrl: string;
}

export interface TokenConfig {
  symbol: string;
  address: string;
  decimals: number;
}

export const CHAINS: Record<EvmChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    chainId: 1,
    label: "Ethereum",
    omnistonCase: "ethereum",
    explorerTx: "https://etherscan.io/tx/",
    nativeSymbol: "ETH",
    rpcUrl: "https://rpc.ankr.com/eth",
    blockExplorerUrl: "https://etherscan.io",
  },
  base: {
    key: "base",
    chainId: 8453,
    label: "Base",
    omnistonCase: "base",
    explorerTx: "https://basescan.org/tx/",
    nativeSymbol: "ETH",
    rpcUrl: "https://rpc.ankr.com/base",
    blockExplorerUrl: "https://basescan.org",
  },
  bnb: {
    key: "bnb",
    chainId: 56,
    label: "BNB Chain",
    omnistonCase: "bnb",
    explorerTx: "https://bscscan.com/tx/",
    nativeSymbol: "BNB",
    rpcUrl: "https://rpc.ankr.com/bsc",
    blockExplorerUrl: "https://bscscan.com",
  },
  polygon: {
    key: "polygon",
    chainId: 137,
    label: "Polygon",
    omnistonCase: "polygon",
    explorerTx: "https://polygonscan.com/tx/",
    nativeSymbol: "POL",
    rpcUrl: "https://rpc.ankr.com/polygon",
    blockExplorerUrl: "https://polygonscan.com",
  },
};

/** Default stablecoin per chain (Omniston cross-chain) */
export const TOKENS_BY_CHAIN: Record<EvmChainKey, TokenConfig[]> = {
  ethereum: [
    {
      symbol: "USDT",
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      decimals: 6,
    },
  ],
  base: [
    {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    },
  ],
  bnb: [
    {
      symbol: "USDT",
      address: "0x55d398326f99059fF775485246999027B3197955",
      decimals: 18,
    },
  ],
  polygon: [
    {
      symbol: "USDC",
      address: "0x3c499c542cEF5e3811e1192ce70d8cc03d5c3359",
      decimals: 6,
    },
    {
      symbol: "pUSD",
      address: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
      decimals: 6,
    },
  ],
};

export const CHAIN_LIST = Object.values(CHAINS);

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
] as const;

export function chainFromId(chainId: number): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.chainId === chainId);
}

export function isSupportedChainId(chainId: number): boolean {
  return CHAIN_LIST.some((c) => c.chainId === chainId);
}
