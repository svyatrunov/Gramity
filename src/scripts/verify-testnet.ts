import {
  Omniston,
  isSwapQuote,
  type AssetId,
  type ChainAddress,
  type QuoteRequest,
  type SettlementParams,
  type SwapSettlementParams,
} from "@ston-fi/omniston-sdk";
import { TonClient } from "@ton/ton";
import { DEX } from "@ston-fi/sdk";

const OMNISTON_WS_URL = "wss://omni-ws-sandbox.ston.fi";
const STON_API_URL = "https://api.ston.fi";
const USDT_TESTNET_ADDRESS =
  "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";
const NATIVE_TON_ADDRESS =
  "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const ROUTER_V2_1_TESTNET =
  "kQALh-JBBIKK7gr0o4AVf9JZnEsFndqO0qTCyT-D-yBsWk0v";
const PTON_V2_1_TESTNET =
  "kQACS30DNoUQ7NfApPvzh7eBmSZ9L4ygJ-lkNWtba8TQT-Px";
const TONSTAKERS_TESTNET_CONTRACT =
  "kQANFsYyYn-GSZ4oajUJmboDURZU-udMHf9JxzO4vYM_hFP3";
const TONCENTER_TESTNET_URL =
  "https://testnet.toncenter.com/api/v2/jsonRPC";
const QUOTE_TIMEOUT_MS = 15_000;
const OUTPUT_TON = 10n;

type StonAsset = {
  contract_address: string;
  symbol?: string;
  display_name?: string;
  tags?: string[];
};

type StonPool = {
  address: string;
  router_address: string;
  token0_address: string;
  token1_address: string;
  reserve0: string;
  reserve1: string;
  deprecated?: boolean;
  [key: string]: unknown;
};

type OnChainPoolInfo = {
  address: string;
  token0_address: string;
  token1_address: string;
  reserve0: string;
  reserve1: string;
  liquidity: string;
  pair_label: string;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function containsTston(value: string): boolean {
  return value.toUpperCase().includes("TSTON");
}

function isTestnetAddress(addr: string): boolean {
  return (
    addr.startsWith("kQ") ||
    addr.startsWith("0Q") ||
    addr.startsWith("k:") ||
    addr.startsWith("0:")
  );
}

function isTonTstonPool(
  pool: StonPool,
  assetByAddress: Map<string, StonAsset>
): boolean {
  const { token0_address: t0, token1_address: t1 } = pool;
  let otherAddr: string | null = null;

  if (t0 === NATIVE_TON_ADDRESS) otherAddr = t1;
  else if (t1 === NATIVE_TON_ADDRESS) otherAddr = t0;
  else return false;

  const otherAsset = assetByAddress.get(otherAddr);
  const otherStr = [
    otherAddr,
    otherAsset?.symbol,
    otherAsset?.display_name,
  ]
    .filter(Boolean)
    .join(" ");

  return containsTston(otherStr);
}

function isTestnetPool(pool: StonPool, tsTonTestnet?: string): boolean {
  if (isTestnetAddress(pool.address)) return true;
  if (isTestnetAddress(pool.router_address)) return true;
  if (
    isTestnetAddress(pool.token0_address) ||
    isTestnetAddress(pool.token1_address)
  ) {
    return true;
  }
  if (
    tsTonTestnet &&
    (pool.token0_address === tsTonTestnet ||
      pool.token1_address === tsTonTestnet)
  ) {
    return true;
  }
  return false;
}

async function fetchTsTonTestnetAddress(): Promise<string | null> {
  const res = await fetch(
    `https://testnet.tonapi.io/v2/staking/pool/${TONSTAKERS_TESTNET_CONTRACT}`
  );
  if (!res.ok) {
    console.log(`tsTON testnet: staking API HTTP ${res.status}`);
    return null;
  }

  const json = (await res.json()) as {
    pool?: { liquid_jetton_master?: string };
  };

  const raw = json.pool?.liquid_jetton_master;
  if (!raw) return null;

  const { Address } = await import("@ton/ton");
  return Address.parse(raw).toString({ bounceable: true, urlSafe: true });
}

type TestnetRouter = {
  getPool(params: {
    token0: string;
    token1: string;
  }): Promise<{
    address: { toString(opts?: { bounceable?: boolean; urlSafe?: boolean }): string };
    getPoolData(): Promise<{ reserve0: bigint; reserve1: bigint }>;
  }>;
};

async function tryOnChainPool(
  router: TestnetRouter,
  token0: string,
  token1: string,
  pairLabel: string
): Promise<OnChainPoolInfo | null> {
  for (const [a, b] of [
    [token0, token1],
    [token1, token0],
  ] as const) {
    try {
      const pool = await router.getPool({ token0: a, token1: b });
      const data = await pool.getPoolData();
      const reserve0 = BigInt(data.reserve0);
      const reserve1 = BigInt(data.reserve1);

      return {
        address: pool.address.toString({ bounceable: true, urlSafe: true }),
        token0_address: a,
        token1_address: b,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        liquidity: (reserve0 * reserve1).toString(),
        pair_label: pairLabel,
      };
    } catch {
      // pool does not exist or contract call failed
    }
  }
  return null;
}

async function discoverTestnetPoolsOnChain(
  tsTonTestnet: string | null
): Promise<OnChainPoolInfo[]> {
  const client = new TonClient({ endpoint: TONCENTER_TESTNET_URL });
  const router = client.open(
    DEX.v2_1.Router.CPI.create(ROUTER_V2_1_TESTNET)
  ) as unknown as TestnetRouter;

  const candidates: Array<[string, string, string]> = [];
  if (tsTonTestnet) {
    candidates.push([PTON_V2_1_TESTNET, tsTonTestnet, "pTON/tsTON"]);
    candidates.push([USDT_TESTNET_ADDRESS, tsTonTestnet, "USDT/tsTON"]);
  }
  candidates.push(
    [
      "kQDLvsZol3juZyOAVG8tWsJntOxeEZWEaWCbbSjYakQpuYN5",
      "kQB_TOJSB7q3-Jm1O8s0jKFtqLElZDPjATs5uJGsujcjznq3",
      "TesREED/TestBlue",
    ],
    [
      "kQDLvsZol3juZyOAVG8tWsJntOxeEZWEaWCbbSjYakQpuYN5",
      PTON_V2_1_TESTNET,
      "TesREED/pTON",
    ],
    [
      "kQB_TOJSB7q3-Jm1O8s0jKFtqLElZDPjATs5uJGsujcjznq3",
      PTON_V2_1_TESTNET,
      "TestBlue/pTON",
    ],
    [USDT_TESTNET_ADDRESS, PTON_V2_1_TESTNET, "USDT/pTON"]
  );

  const found: OnChainPoolInfo[] = [];

  for (const [a, b, label] of candidates) {
    await sleep(2_000);
    const pool = await tryOnChainPool(router, a, b, label);
    if (!pool) continue;
    if (BigInt(pool.reserve0) > 0n && BigInt(pool.reserve1) > 0n) {
      found.push(pool);
    }
  }

  return found.sort(
    (x, y) => Number(BigInt(y.liquidity) - BigInt(x.liquidity))
  );
}

async function discoverTonTstonPool(): Promise<void> {
  console.log("\n── TON/tsTON POOL DISCOVERY ────────────────────────────────");

  const tsTonTestnet = await fetchTsTonTestnetAddress();
  if (tsTonTestnet) {
    console.log(`tsTON testnet jetton: ${tsTonTestnet}`);
  } else {
    console.log("tsTON testnet jetton: not found via Tonstakers API");
  }

  const [poolsRes, assetsRes] = await Promise.all([
    fetch(`${STON_API_URL}/v1/pools?dex_v2=true`),
    fetch(`${STON_API_URL}/v1/assets`),
  ]);

  if (!poolsRes.ok || !assetsRes.ok) {
    console.log(
      `API error: pools=${poolsRes.status} assets=${assetsRes.status}`
    );
    return;
  }

  const poolsJson = (await poolsRes.json()) as { pool_list?: StonPool[] };
  const assetsJson = (await assetsRes.json()) as { asset_list?: StonAsset[] };
  const pools = poolsJson.pool_list ?? [];
  const assetByAddress = new Map(
    (assetsJson.asset_list ?? []).map((a) => [a.contract_address, a])
  );

  const tonTstonPools = pools.filter((p) =>
    isTonTstonPool(p, assetByAddress)
  );
  const testnetTonTstonPools = tonTstonPools.filter((p) =>
    isTestnetPool(p, tsTonTestnet ?? undefined)
  );

  console.log(
    `API: ${tonTstonPools.length} TON/tsTON pool(s) total (mainnet API)`
  );

  if (testnetTonTstonPools.length > 0) {
    const pool = testnetTonTstonPools[0];
    console.log(`POOL FOUND (testnet via API): ${pool.address}`);
    console.log(`  token0: ${pool.token0_address}`);
    console.log(`  token1: ${pool.token1_address}`);

    const detailRes = await fetch(
      `${STON_API_URL}/v1/pools/${pool.address}`
    );
    const detailJson = await detailRes.json();
    console.log("Full pool JSON:");
    console.log(JSON.stringify(detailJson, null, 2));
    return;
  }

  console.log(
    "TON/tsTON pool NOT FOUND on testnet in STON.fi API (api.ston.fi is mainnet-only)."
  );

  if (tsTonTestnet) {
    console.log("Checking testnet on-chain (router + pTON)...");
    const client = new TonClient({ endpoint: TONCENTER_TESTNET_URL });
    const router = client.open(
      DEX.v2_1.Router.CPI.create(ROUTER_V2_1_TESTNET)
    ) as unknown as TestnetRouter;

    await sleep(2_000);
    const onChainTonTston = await tryOnChainPool(
      router,
      PTON_V2_1_TESTNET,
      tsTonTestnet,
      "pTON/tsTON"
    );

    if (
      onChainTonTston &&
      BigInt(onChainTonTston.reserve0) > 0n &&
      BigInt(onChainTonTston.reserve1) > 0n
    ) {
      console.log(`POOL FOUND (testnet on-chain): ${onChainTonTston.address}`);
      console.log(`  token0: ${onChainTonTston.token0_address}`);
      console.log(`  token1: ${onChainTonTston.token1_address}`);
      console.log("Full pool JSON:");
      console.log(
        JSON.stringify(
          {
            pool: {
              address: onChainTonTston.address,
              router_address: ROUTER_V2_1_TESTNET,
              token0_address: onChainTonTston.token0_address,
              token1_address: onChainTonTston.token1_address,
              reserve0: onChainTonTston.reserve0,
              reserve1: onChainTonTston.reserve1,
              source: "testnet on-chain getPoolData",
            },
          },
          null,
          2
        )
      );
      return;
    }

    if (onChainTonTston) {
      console.log(
        `TON/tsTON pool exists on testnet but has zero liquidity: ${onChainTonTston.address}`
      );
    } else {
      console.log("TON/tsTON pool does not exist on testnet on-chain.");
    }
  }

  console.log("\n── FALLBACK: testnet pools with liquidity (top 3) ────────────");
  const liquidPools = await discoverTestnetPoolsOnChain(tsTonTestnet);

  if (liquidPools.length === 0) {
    console.log(
      "No testnet pools with non-zero liquidity found on STON.fi router."
    );
    return;
  }

  liquidPools.slice(0, 3).forEach((p, i) => {
    console.log(
      `#${i + 1} ${p.pair_label} | pool=${p.address} | token0=${p.token0_address} | token1=${p.token1_address} | reserve0=${p.reserve0} | reserve1=${p.reserve1}`
    );
  });
}

async function checkOmnistonQuote(): Promise<void> {
  const omniston = new Omniston({ apiUrl: OMNISTON_WS_URL });

  const dummyTrader: ChainAddress = {
    chain: {
      $case: "ton",
      value: NATIVE_TON_ADDRESS,
    },
  };

  const inputAsset: AssetId = {
    chain: {
      $case: "ton",
      value: { kind: { $case: "jetton", value: USDT_TESTNET_ADDRESS } },
    },
  };

  const outputAsset: AssetId = {
    chain: {
      $case: "ton",
      value: { kind: { $case: "native", value: {} } },
    },
  };

  const settlementParams: SettlementParams[] = [
    {
      params: {
        $case: "swap",
        value: {
          maxPriceSlippagePips: 10_000,
          flexibleIntegratorFee: false,
        } satisfies SwapSettlementParams,
      },
    },
  ];

  const quoteRequest: QuoteRequest = {
    inputAsset,
    outputAsset,
    amount: {
      $case: "outputUnits",
      value: String(OUTPUT_TON * 1_000_000_000n),
    },
    settlementParams,
    integratorAddress: dummyTrader,
    integratorFeePips: 0,
  };

  await new Promise<void>((resolve) => {
    let settled = false;
    let reason = "timeout after 15s";

    const finish = (message: string) => {
      if (settled) return;
      settled = true;
      console.log(message);
      sub.unsubscribe();
      resolve();
    };

    const timeout = setTimeout(
      () => finish(`NO QUOTE: ${reason}`),
      QUOTE_TIMEOUT_MS
    );

    const sub = omniston.requestForQuote(quoteRequest).subscribe({
      next(event) {
        switch (event?.$case) {
          case "quoteUpdated": {
            const q = event.value;
            if (isSwapQuote(q)) {
              clearTimeout(timeout);
              finish("QUOTE OK");
            }
            break;
          }
          case "noQuote":
            reason = `noQuote: ${JSON.stringify(event.value)}`;
            clearTimeout(timeout);
            finish(`NO QUOTE: ${reason}`);
            break;
          case "unsubscribed":
            reason = "RFQ stream closed before quote";
            clearTimeout(timeout);
            finish(`NO QUOTE: ${reason}`);
            break;
        }
      },
      error(err) {
        reason = (err as Error).message ?? String(err);
        clearTimeout(timeout);
        finish(`NO QUOTE: ${reason}`);
      },
    });
  });
}

async function checkTestnetUsdt(): Promise<void> {
  const res = await fetch(`${STON_API_URL}/v1/assets`);
  if (!res.ok) {
    console.log(`USDT testnet: assets API HTTP ${res.status}`);
    return;
  }

  const json = (await res.json()) as { asset_list?: StonAsset[] };
  const assets = json.asset_list ?? [];

  const usdt = assets.find(
    (a) => a.contract_address === USDT_TESTNET_ADDRESS
  );

  if (usdt?.contract_address) {
    console.log(usdt.contract_address);
  } else {
    console.log("USDT testnet: not found in assets list");
  }
}

async function main() {
  await checkOmnistonQuote();
  await discoverTonTstonPool();
  console.log("\n── USDT testnet ──────────────────────────────────────────────");
  await checkTestnetUsdt();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
