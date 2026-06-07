import {
  Omniston,
  isOrderQuote,
  isHtlcOrderQuote,
  type AssetId,
  type ChainAddress,
  type Quote,
  type QuoteRequest,
} from "@ston-fi/omniston-sdk";
import type { EvmChainKey, TokenConfig } from "./chains";
import { CHAINS } from "./chains";

let client: Omniston | null = null;

export function getOmniston(wsUrl: string): Omniston {
  if (!client) {
    client = new Omniston({ apiUrl: wsUrl });
  }
  return client;
}

export function evmAsset(chain: EvmChainKey, token: TokenConfig): AssetId {
  const cfg = CHAINS[chain];
  return {
    chain: {
      $case: cfg.omnistonCase,
      value: { kind: { $case: "erc20", value: token.address } },
    },
  };
}

export function tonUsdtAsset(tonUsdtAddress: string): AssetId {
  return {
    chain: {
      $case: "ton",
      value: { kind: { $case: "jetton", value: tonUsdtAddress } },
    },
  };
}

export function evmAddress(chain: EvmChainKey, address: string): ChainAddress {
  return { chain: { $case: CHAINS[chain].omnistonCase, value: address } };
}

export function tonAddress(address: string): ChainAddress {
  return { chain: { $case: "ton", value: address } };
}

export function buildQuoteRequest(
  chain: EvmChainKey,
  token: TokenConfig,
  amountHuman: string,
  tonUsdtAddress: string,
  destinationTonAddress: string
): QuoteRequest {
  const decimals = token.decimals;
  const [whole, frac = ""] = amountHuman.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  const inputUnits = (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0")).toString();

  return {
    inputAsset: evmAsset(chain, token),
    outputAsset: tonUsdtAsset(tonUsdtAddress),
    amount: { $case: "inputUnits", value: inputUnits },
    settlementParams: [{ params: { $case: "order", value: {} } }],
    integratorAddress: tonAddress(destinationTonAddress),
  };
}

export function fetchQuote(
  wsUrl: string,
  request: QuoteRequest,
  timeoutMs = 30_000
): Promise<Quote> {
  const omniston = getOmniston(wsUrl);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("Котировка не получена за 30 сек"));
    }, timeoutMs);

    const sub = omniston.requestForQuote(request).subscribe({
      next: (event) => {
        if (event?.$case === "quoteUpdated") {
          if (isOrderQuote(event.value)) {
            clearTimeout(timeout);
            sub.unsubscribe();
            resolve(event.value);
          }
        } else if (event?.$case === "noQuote") {
          clearTimeout(timeout);
          sub.unsubscribe();
          reject(new Error("Нет доступных маршрутов для этой пары"));
        }
      },
      error: (err) => {
        clearTimeout(timeout);
        sub.unsubscribe();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}

export function formatOutputUsdt(quote: Quote, decimals = 6): string {
  const units = BigInt(quote.outputUnits);
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const frac = (units % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function getProtocolSpender(quote: Quote): string | null {
  if (!isOrderQuote(quote)) return null;
  return quote.settlementData.value.srcProtocolContractAddress.chain.value;
}

export { isOrderQuote, isHtlcOrderQuote };
