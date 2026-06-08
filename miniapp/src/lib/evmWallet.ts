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
  needsExternalBrowserForMetaMask,
  redirectToExternalBrowserForMetaMask,
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
  if (needsExternalBrowserForMetaMask()) {
    redirectToExternalBrowserForMetaMask();
    throw new WalletError(
      "Откройте Gramity в браузере и подтвердите подключение в MetaMask",
      "EXTERNAL_BROWSER"
    );
  }

  let eip1193: Eip1193Provider | null = getBrowserExtensionProvider();

  if (!eip1193) {
    try {
      await connectMetaMaskWallet();
      eip1193 = (await getMetaMaskConnectProvider()) as Eip1193Provider;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("reject") || msg.includes("4001")) {
        throw new WalletError("Подключение отклонено", "USER_REJECTED");
      }
      throw new WalletError(
        "Не удалось открыть MetaMask. Подтвердите подключение в приложении MetaMask.",
        "CONNECT_FAILED"
      );
    }
  }

  if (!eip1193) {
    throw new WalletError(
      "MetaMask недоступен. Установите приложение или откройте Gramity в браузере с расширением."
    );
  }

  const provider = new BrowserProvider(eip1193);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  return { provider, signer, address, chainId: Number(network.chainId) };
}

async function getActiveProvider(): Promise<Eip1193Provider> {
  const ext = getBrowserExtensionProvider();
  if (ext) return ext;
  return (await getMetaMaskConnectProvider()) as Eip1193Provider;
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
      throw new WalletError(
        `Сеть ${chain.label} не добавлена в MetaMask. Добавьте её вручную (chainId ${chain.chainId}).`,
        "CHAIN_NOT_ADDED"
      );
    }
    if (e.code === 4001) {
      throw new WalletError("Смена сети отклонена", "USER_REJECTED");
    }
    throw new WalletError(e.message ?? "Не удалось переключить сеть");
  }
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
  spender: string
): Promise<string> {
  const contract = new Contract(token.address, ERC20_ABI, signer);
  try {
    const tx = await contract.approve(spender, MaxUint256);
    return tx.hash as string;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; reason?: string };
    if (e.code === "ACTION_REJECTED" || e.code === "4001") {
      throw new WalletError("Approve отклонён", "USER_REJECTED");
    }
    if (e.message?.includes("insufficient funds")) {
      throw new WalletError("Недостаточно газа для approve", "INSUFFICIENT_GAS");
    }
    throw new WalletError(e.reason ?? e.message ?? "Approve failed");
  }
}

export async function waitTx(provider: BrowserProvider, hash: string): Promise<void> {
  const receipt = await provider.waitForTransaction(hash);
  if (!receipt || receipt.status === 0) {
    throw new WalletError("Транзакция не прошла (reverted)", "TX_FAILED");
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

export async function registerCrossChainOrder(
  wsUrl: string,
  quote: Quote,
  chainKey: import("./chains").EvmChainKey,
  evmWalletAddress: string,
  destinationTonAddress: string,
  signer: Signer
): Promise<void> {
  if (!isHtlcOrderQuote(quote)) {
    throw new WalletError("Ожидалась cross-chain котировка (order/HTLC)");
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
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function parseWalletError(err: unknown): string {
  if (err instanceof WalletError) return err.message;
  const e = err as { code?: string; message?: string; reason?: string };
  if (e.code === "ACTION_REJECTED" || e.code === "4001") {
    return "Транзакция отклонена в кошельке";
  }
  if (e.message?.includes("insufficient funds")) {
    return "Недостаточно газа на кошельке";
  }
  return e.reason ?? e.message ?? "Неизвестная ошибка";
}
