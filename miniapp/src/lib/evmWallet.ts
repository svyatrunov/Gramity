import { BrowserProvider, Contract, AbiCoder, Signature, getBytes, MaxUint256, type Signer } from "ethers";
import type { Quote } from "@ston-fi/omniston-sdk";
import {
  getOmniston,
  evmAddress,
  tonAddress,
  isHtlcOrderQuote,
} from "./omnistonClient";
import { generateHtlcSecret, generateHtlcHashlock } from "./htlc";
import { ERC20_ABI, type ChainConfig, type TokenConfig } from "./chains";
import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  getBrowserExtensionProvider,
  requestFreshMetaMaskAccounts,
} from "./metamaskConnect";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export class WalletError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export function hasMetaMask(): boolean {
  return getBrowserExtensionProvider() !== null || typeof window !== "undefined";
}

export async function connectMetaMask(): Promise<{
  provider: BrowserProvider;
  signer: Signer;
  address: string;
  chainId: number;
}> {
  let eip1193: Eip1193Provider | null = getBrowserExtensionProvider();

  if (!eip1193) {
    try {
      const conn = await connectMetaMaskWallet();
      eip1193 = (await getMetaMaskConnectProvider()) as Eip1193Provider;
      const provider = new BrowserProvider(eip1193);
      const signer = await provider.getSigner(conn.accounts[0]);
      const network = await provider.getNetwork();
      return {
        provider,
        signer,
        address: conn.accounts[0],
        chainId: Number(network.chainId),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("reject") || msg.includes("4001")) {
        throw new WalletError("Connection rejected", "USER_REJECTED");
      }
      if (msg.includes("-32002") || msg.toLowerCase().includes("pending")) {
        throw new WalletError(
          "Approve the connection in MetaMask, then return to Telegram",
          "CONNECT_PENDING"
        );
      }
      if (msg.toLowerCase().includes("timeout")) {
        throw new WalletError(
          "Approve the connection in MetaMask, then return to Telegram",
          "CONNECT_TIMEOUT"
        );
      }
      throw new WalletError(
        "Could not connect MetaMask. Approve the request in the app and return to Telegram.",
        "CONNECT_FAILED"
      );
    }
  }

  if (!eip1193) {
    throw new WalletError(
      "MetaMask is unavailable. Install the app or open Gramity in a browser with the extension."
    );
  }

  const accounts = await requestFreshMetaMaskAccounts(eip1193);
  const provider = new BrowserProvider(eip1193);
  const signer = await provider.getSigner(accounts[0]);
  const network = await provider.getNetwork();
  return {
    provider,
    signer,
    address: accounts[0],
    chainId: Number(network.chainId),
  };
}

export async function connectNativeEthereum(): Promise<{
  provider: BrowserProvider;
  signer: Signer;
  address: string;
  chainId: number;
}> {
  const eip1193 = getBrowserExtensionProvider();
  if (!eip1193) {
    throw new WalletError(
      "Open this page in the MetaMask in-app browser.",
      "NO_PROVIDER"
    );
  }
  try {
    const accounts = await requestFreshMetaMaskAccounts(eip1193);
    const provider = new BrowserProvider(eip1193);
    const signer = await provider.getSigner(accounts[0]);
    const network = await provider.getNetwork();
    return {
      provider,
      signer,
      address: accounts[0],
      chainId: Number(network.chainId),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("reject") || msg.includes("4001")) {
      throw new WalletError("Connection rejected in MetaMask", "USER_REJECTED");
    }
    throw new WalletError(msg || "MetaMask connection failed", "CONNECT_FAILED");
  }
}

async function getActiveProvider(): Promise<Eip1193Provider> {
  const ext = getBrowserExtensionProvider();
  if (ext) return ext;
  return (await getMetaMaskConnectProvider()) as Eip1193Provider;
}

type Eip1193EventProvider = Eip1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

async function addChain(ethereum: Eip1193Provider, chain: ChainConfig): Promise<void> {
  const hexId = "0x" + chain.chainId.toString(16);
  await ethereum.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: hexId,
        chainName: chain.label,
        rpcUrls: [chain.rpcUrl],
        nativeCurrency: {
          name: chain.nativeSymbol,
          symbol: chain.nativeSymbol,
          decimals: 18,
        },
        blockExplorerUrls: [chain.blockExplorerUrl],
      },
    ],
  });
}

export async function switchChain(chain: ChainConfig): Promise<void> {
  const ethereum = await getActiveProvider();

  const hexId = "0x" + chain.chainId.toString(16);

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 4902) {
      try {
        await addChain(ethereum, chain);
      } catch (addErr: unknown) {
        const ae = addErr as { code?: number; message?: string };
        if (ae.code === 4001) {
          throw new WalletError("Network add rejected", "USER_REJECTED");
        }
        throw new WalletError(
          `Network ${chain.label} is not added in MetaMask. Add it manually (chainId ${chain.chainId}).`,
          "CHAIN_NOT_ADDED"
        );
      }
      return;
    }
    if (e.code === 4001) {
      throw new WalletError("Network switch rejected", "USER_REJECTED");
    }
    throw new WalletError(e.message ?? "Failed to switch network");
  }
}

/** Recreate ethers BrowserProvider after wallet_switchEthereumChain — stale instances throw NETWORK_ERROR. */
export async function refreshBrowserProvider(preferredAddress?: string): Promise<{
  provider: BrowserProvider;
  signer: Signer;
  address: string;
  chainId: number;
}> {
  const eip1193 = await getActiveProvider();
  const provider = new BrowserProvider(eip1193);
  const accounts = (await eip1193.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.length) {
    throw new WalletError("Wallet is not connected", "NOT_CONNECTED");
  }
  const address =
    preferredAddress && accounts.some((a) => a.toLowerCase() === preferredAddress.toLowerCase())
      ? preferredAddress
      : accounts[0];
  const signer = await provider.getSigner(address);
  const network = await provider.getNetwork();
  return {
    provider,
    signer,
    address,
    chainId: Number(network.chainId),
  };
}

export async function ensureWalletOnChain(
  chain: ChainConfig,
  preferredAddress?: string
): Promise<{
  provider: BrowserProvider;
  signer: Signer;
  address: string;
  chainId: number;
}> {
  const current = await refreshBrowserProvider(preferredAddress);
  if (current.chainId !== chain.chainId) {
    await switchChain(chain);
    return refreshBrowserProvider(preferredAddress ?? current.address);
  }
  return current;
}

export function subscribeWalletChainChanged(
  onChainId: (chainId: number) => void
): () => void {
  let active = true;
  let ethereum: Eip1193EventProvider | null = null;

  function handleChainChanged(hexId: unknown) {
    const chainId = typeof hexId === "string" ? parseInt(hexId, 16) : Number(hexId);
    if (!Number.isNaN(chainId)) onChainId(chainId);
  }

  function attach(provider: Eip1193EventProvider) {
    if (!active) return;
    ethereum = provider;
    ethereum.on?.("chainChanged", handleChainChanged);
  }

  const ext = getBrowserExtensionProvider();
  if (ext) {
    attach(ext);
  } else {
    void getMetaMaskConnectProvider().then((p) => attach(p as Eip1193EventProvider));
  }

  return () => {
    active = false;
    ethereum?.removeListener?.("chainChanged", handleChainChanged);
  };
}

export async function readTokenBalance(
  provider: BrowserProvider,
  token: TokenConfig,
  owner: string
): Promise<string> {
  const contract = new Contract(token.address, ERC20_ABI, provider);
  const raw: bigint = await contract.balanceOf(owner);
  const decimals: number = token.decimals;
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = (raw % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export async function readAllowance(
  provider: BrowserProvider,
  token: TokenConfig,
  owner: string,
  spender: string
): Promise<bigint> {
  const contract = new Contract(token.address, ERC20_ABI, provider);
  return contract.allowance(owner, spender) as Promise<bigint>;
}

export async function approveToken(
  signer: Signer,
  token: TokenConfig,
  spender: string,
  amount?: bigint
): Promise<string> {
  const contract = new Contract(token.address, ERC20_ABI, signer);
  try {
    const tx = await contract.approve(spender, amount ?? MaxUint256);
    return tx.hash as string;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; reason?: string };
    if (e.code === "ACTION_REJECTED" || e.code === "4001") {
      throw new WalletError("Approve rejected", "USER_REJECTED");
    }
    if (e.message?.includes("insufficient funds")) {
      throw new WalletError("Insufficient gas for approve", "INSUFFICIENT_GAS");
    }
    throw new WalletError(e.reason ?? e.message ?? "Approve failed");
  }
}

export async function waitTx(provider: BrowserProvider, hash: string): Promise<void> {
  const receipt = await provider.waitForTransaction(hash);
  if (!receipt || receipt.status === 0) {
    throw new WalletError("Transaction reverted", "TX_FAILED");
  }
}

export async function estimateGasCost(
  provider: BrowserProvider,
  quote: Quote
): Promise<{ gasUnits: string; gasCostNative: string; nativeSymbol: string } | null> {
  if (!quote.estimatedGasConsumption && !quote.gasBudget) return null;

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const gasUnits = BigInt(quote.estimatedGasConsumption ?? quote.gasBudget ?? "0");
  const cost = gasUnits * gasPrice;
  const network = await provider.getNetwork();

  const nativeSymbols: Record<number, string> = {
    1: "ETH",
    8453: "ETH",
    56: "BNB",
    137: "POL",
  };

  return {
    gasUnits: gasUnits.toString(),
    gasCostNative: (Number(cost) / 1e18).toFixed(6),
    nativeSymbol: nativeSymbols[Number(network.chainId)] ?? "ETH",
  };
}

interface Eip712TypedData {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

function encodeTypedDataMessage(typedData: Eip712TypedData): Uint8Array {
  const fields = typedData.types[typedData.primaryType];
  const types = fields.map((f) => f.type);
  const values = fields.map((f) => typedData.message[f.name]);
  return getBytes(AbiCoder.defaultAbiCoder().encode(types, values));
}

function encodeCompactSignature(signatureHex: string): Uint8Array {
  const sig = Signature.from(signatureHex);
  return getBytes(sig.compactSerialized);
}

export interface RegisterCrossChainOrderResult {
  htlcSecrets: Uint8Array[];
}

export async function registerCrossChainOrder(
  wsUrl: string,
  quote: Quote,
  chainKey: import("./chains").EvmChainKey,
  evmWalletAddress: string,
  destinationTonAddress: string,
  signer: Signer
): Promise<RegisterCrossChainOrderResult> {
  if (!isHtlcOrderQuote(quote)) {
    throw new WalletError("Expected a cross-chain quote (order/HTLC)");
  }

  const omniston = getOmniston(wsUrl);
  const htlcSecrets = [generateHtlcSecret()];
  const hashingFn = quote.settlementData.value.htlcHashingFunction;

  const orderPayload = await omniston.evmBuildOrderPayload({
    quoteId: quote.quoteId,
    ownerSrcAddress: evmAddress(chainKey, evmWalletAddress),
    traderDstAddress: tonAddress(destinationTonAddress),
    traderDstDiscloseAddress: tonAddress(destinationTonAddress),
    htlcSecrets: {
      secretMode: {
        $case: "provided",
        value: {
          hashes: htlcSecrets.map((s) => generateHtlcHashlock(s, hashingFn)),
        },
      },
    },
  });

  const typedData = JSON.parse(orderPayload.typedData) as Eip712TypedData;
  const signatureHex = await signer.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message
  );

  await omniston.orderRegisterSignedOrder({
    quoteId: quote.quoteId,
    ownerSrcAddress: evmAddress(chainKey, evmWalletAddress),
    signedOrder: {
      order: {
        $case: "evmV1",
        value: {
          encodedOrder: encodeTypedDataMessage(typedData),
          signature: encodeCompactSignature(signatureHex),
          orderExtension: orderPayload.orderExtension,
        },
      },
    },
    serializedOrderDetails: orderPayload.serializedOrderDetails,
  });

  return { htlcSecrets };
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function parseWalletError(err: unknown): string {
  if (err instanceof WalletError) return err.message;
  const e = err as { code?: string; message?: string; reason?: string };
  if (e.code === "ACTION_REJECTED" || e.code === "4001") {
    return "Transaction rejected in wallet";
  }
  if (e.code === "NETWORK_ERROR" || e.message?.includes("network changed")) {
    return "Network changed in MetaMask. Try again — the app will reconnect.";
  }
  if (e.message?.includes("insufficient funds")) {
    return "Insufficient gas in wallet";
  }
  return e.reason ?? e.message ?? "Unknown error";
}
