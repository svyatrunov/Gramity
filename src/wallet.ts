import { mnemonicToWalletKey } from "@ton/crypto";
import {
  WalletContractV4,
  TonClient,
  fromNano,
  Address,
  type OpenedContract,
} from "@ton/ton";
import {
  getMnemonic,
  TONCENTER_API_KEY,
  TONCENTER_URL,
} from "./config.js";

export interface WalletContext {
  key: Awaited<ReturnType<typeof mnemonicToWalletKey>>;
  wallet: WalletContractV4;
  client: TonClient;
  contract: OpenedContract<WalletContractV4>;
  address: string;
}

export async function createWallet(): Promise<WalletContext> {
  const key = await mnemonicToWalletKey(getMnemonic());

  const wallet = WalletContractV4.create({
    publicKey: key.publicKey,
    workchain: 0,
  });

  const client = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  const contract = client.open(wallet);

  const address = wallet.address.toString({ urlSafe: true, bounceable: true });

  console.log("═══════════════════════════════════════════");
  console.log("  Gramity DCA Engine — TON Mainnet");
  console.log("═══════════════════════════════════════════");
  console.log("[WALLET] Address:", address);

  const balance = await client.getBalance(Address.parse(address));
  console.log("[WALLET] TON balance:", fromNano(balance), "TON");

  if (balance < BigInt(2_000_000_000)) {
    console.warn(
      "[WALLET] ⚠  Balance < 2 TON — ensure wallet has sufficient funds for gas"
    );
  }

  return { key, wallet, client, contract, address };
}

/** Poll TON balance until it increases */
export async function waitForBalanceIncrease(
  ctx: WalletContext,
  initialBalance: bigint,
  timeoutMs = 300_000,
  pollMs = 5_000
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const bal = await ctx.client.getBalance(Address.parse(ctx.address));
    if (bal > initialBalance) return bal;
  }
  throw new Error("waitForBalanceIncrease: timeout");
}

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
