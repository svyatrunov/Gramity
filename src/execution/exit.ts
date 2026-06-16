/**
 * Withdrawal — transfers the agent wallet's holdings AS IS to the user's
 * withdrawal address. No LP unwinding / unstaking.
 *
 *   1. Send every selected non-native jetton (USDT, tsTON, LP, other popular
 *      jettons) to the withdrawal address — tokens FIRST.
 *   2. Then send the remaining native coin (TON/Gram) — LAST, after the gas
 *      spent on the jetton transfers above.
 *
 * Every transfer is journalled (withdrawal_log) with a tx hash + status, so a
 * partial failure can be inspected and resumed without re-sending what already
 * went out.
 */

import {
  Address,
  JettonMaster,
  JettonWallet,
  fromNano,
  toNano,
  type OpenedContract,
  WalletContractV4,
  internal,
  SendMode,
} from "@ton/ton";
import {
  type Plan,
  startWithdrawalBatch,
  markWithdrawalItem,
  getBatchItems,
  type WithdrawalItem,
} from "../db/index.js";
import { getUserWalletContext } from "../services/userWallet.js";
import { sendJettonTransfer } from "../services/jetton.js";
import { getAllVerifiedJettons, getTonBalance, getLastTxHash } from "../services/tonapi.js";
import { isPopularJettonAddress } from "../shared/popular-ton-jettons.js";
import { POOL_ADDRESS, TSTON_ADDRESS, USDT_ADDRESS, USDT_DECIMALS } from "../config.js";
import { sleep } from "../wallet.js";
import type { WalletContext } from "../wallet.js";
import { hasWithdrawalAddress } from "../utils/tonAddress.js";

export type WithdrawAssetFilter = "all" | "usdt" | "native";

export interface ExitItemResult {
  asset: string;
  amount: string;
  status: "sent" | "failed" | "skipped";
  txHash: string | null;
  error?: string;
}

export interface ExitResult {
  usdtSent: number;
  summary: string[];
  batchId: string;
  items: ExitItemResult[];
  gasWarning?: string;
}

export interface ExitOptions {
  /** Which assets to withdraw. Default "all". */
  assets?: WithdrawAssetFilter;
  /** Resume an existing batch instead of creating a new one. */
  batchId?: string;
}

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

const NATIVE = "native";
const GAS_RESERVE = toNano("0.3");
const MIN_TON_SEND = toNano("0.05");
const GAS_PER_JETTON = toNano("0.12");
const TX_GAP_MS = 2_500;

interface TokenMeta {
  master: string;
  symbol: string;
  decimals: number;
}

const KNOWN: Record<string, { symbol: string; decimals: number }> = {
  [USDT_ADDRESS.toLowerCase()]: { symbol: "USDT", decimals: USDT_DECIMALS },
  [TSTON_ADDRESS.toLowerCase()]: { symbol: "tsTON", decimals: 9 },
  [POOL_ADDRESS.toLowerCase()]: { symbol: "LP", decimals: 9 },
};

async function getJettonBalanceOnChain(
  walletCtx: WalletContext,
  jettonMasterAddr: string
): Promise<bigint> {
  try {
    const master = walletCtx.client.open(
      JettonMaster.create(Address.parse(jettonMasterAddr))
    );
    const userWalletAddr = await master.getWalletAddress(
      Address.parse(walletCtx.address)
    );
    const userWallet = walletCtx.client.open(JettonWallet.create(userWalletAddr));
    return await userWallet.getBalance();
  } catch {
    return 0n;
  }
}

/** Decimals/symbol for a master (known assets, else from the verified list). */
function metaFor(master: string, verified: TokenMeta[]): TokenMeta {
  const k = master.toLowerCase();
  if (KNOWN[k]) return { master, symbol: KNOWN[k].symbol, decimals: KNOWN[k].decimals };
  const v = verified.find((t) => t.master.toLowerCase() === k);
  return v ?? { master, symbol: "?", decimals: 9 };
}

/** Build the ordered list of jetton masters to sweep, given the asset filter. */
async function buildJettonList(
  walletCtx: WalletContext,
  filter: WithdrawAssetFilter
): Promise<TokenMeta[]> {
  if (filter === "native") return [];
  if (filter === "usdt") {
    return [{ master: USDT_ADDRESS, symbol: "USDT", decimals: USDT_DECIMALS }];
  }
  const tokens: TokenMeta[] = [
    { master: USDT_ADDRESS, symbol: "USDT", decimals: USDT_DECIMALS },
    { master: TSTON_ADDRESS, symbol: "tsTON", decimals: 9 },
    { master: POOL_ADDRESS, symbol: "LP", decimals: 9 },
  ];
  const seen = new Set(tokens.map((t) => t.master.toLowerCase()));
  try {
    const verified = await getAllVerifiedJettons(walletCtx.address);
    for (const v of verified) {
      const key = v.jettonAddress.toLowerCase();
      if (seen.has(key) || !isPopularJettonAddress(v.jettonAddress)) continue;
      seen.add(key);
      tokens.push({ master: v.jettonAddress, symbol: v.symbol, decimals: v.decimals });
    }
  } catch (err) {
    console.warn("[EXIT] Verified-jetton scan failed (non-fatal):", (err as Error).message);
  }
  return tokens;
}

async function sendNative(
  walletCtx: WalletContext,
  amountNano: bigint,
  toAddress: string
): Promise<void> {
  const typedContract = walletCtx.contract as unknown as TypedContract;
  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(walletCtx.key.secretKey),
    messages: [internal({ to: Address.parse(toAddress), value: amountNano, bounce: false })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
}

/** Process one journalled item: re-read current balance, send, mark status. */
async function processItem(
  walletCtx: WalletContext,
  item: { id: string; asset: string; master: string },
  toAddress: string,
  verified: TokenMeta[]
): Promise<ExitItemResult> {
  try {
    if (item.master === NATIVE) {
      const bal = await getTonBalance(walletCtx.address);
      const sendable = bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n;
      if (sendable < MIN_TON_SEND) {
        await markWithdrawalItem(item.id, "skipped", null, "below minimum");
        return { asset: item.asset, amount: "0", status: "skipped", txHash: null };
      }
      await sendNative(walletCtx, sendable, toAddress);
      const txHash = await getLastTxHash(walletCtx.address, 3_000);
      const human = Number(fromNano(sendable)).toFixed(3);
      await markWithdrawalItem(item.id, "sent", txHash, null);
      return { asset: item.asset, amount: human, status: "sent", txHash };
    }

    const bal = await getJettonBalanceOnChain(walletCtx, item.master);
    if (bal <= 0n) {
      await markWithdrawalItem(item.id, "skipped", null, "zero balance");
      return { asset: item.asset, amount: "0", status: "skipped", txHash: null };
    }
    await sendJettonTransfer(walletCtx, item.master, bal, toAddress);
    const txHash = await getLastTxHash(walletCtx.address, 3_000);
    const meta = metaFor(item.master, verified);
    const digits = meta.symbol === "USDT" ? 2 : 4;
    const human = (Number(bal) / Math.pow(10, meta.decimals || 9)).toFixed(digits);
    await markWithdrawalItem(item.id, "sent", txHash, null);
    return { asset: item.asset, amount: human, status: "sent", txHash };
  } catch (err) {
    const msg = (err as Error).message;
    await markWithdrawalItem(item.id, "failed", null, msg);
    return { asset: item.asset, amount: "0", status: "failed", txHash: null, error: msg };
  }
}

export async function executeFullExit(
  plan: Plan,
  opts: ExitOptions = {}
): Promise<ExitResult> {
  if (!hasWithdrawalAddress(plan.ton_address)) {
    throw new Error("Withdrawal address not set");
  }
  const toAddress = plan.ton_address as string;
  const telegramId = plan.telegram_id;
  const filter: WithdrawAssetFilter = opts.assets ?? "all";
  const walletCtx = await getUserWalletContext(telegramId);

  console.log(
    `[EXIT] Withdrawal (as-is) user ${telegramId} filter=${filter}${opts.batchId ? " resume=" + opts.batchId : ""}`
  );

  // Resolve metadata source for nice symbols/decimals.
  const jettonList = await buildJettonList(walletCtx, filter);

  // ── Gas guard ──────────────────────────────────────────────────────────────
  let gasWarning: string | undefined;
  try {
    const nativeBal = await getTonBalance(walletCtx.address);
    const need = BigInt(jettonList.length) * GAS_PER_JETTON;
    if (nativeBal < need) {
      gasWarning =
        `Low gas: wallet holds ${fromNano(nativeBal)} TON but ~${fromNano(need)} ` +
        `is needed to send ${jettonList.length} token transfer(s). Some may be skipped — top up and resume.`;
      console.warn("[EXIT] " + gasWarning);
    }
  } catch { /* non-fatal */ }

  // ── Resolve the batch (new or resumed) ─────────────────────────────────────
  let batchId: string;
  let pending: { id: string; asset: string; master: string }[];

  if (opts.batchId) {
    batchId = opts.batchId;
    const existing: WithdrawalItem[] = await getBatchItems(batchId);
    pending = existing
      .filter((i) => i.status === "pending" || i.status === "failed")
      .map((i) => ({ id: i.id, asset: i.asset, master: i.master }));
  } else {
    const items: { asset: string; master: string; amountRaw: bigint }[] = [];
    for (const t of jettonList) {
      const bal = await getJettonBalanceOnChain(walletCtx, t.master);
      if (bal > 0n) items.push({ asset: t.symbol, master: t.master, amountRaw: bal });
    }
    if (filter === "all" || filter === "native") {
      const bal = await getTonBalance(walletCtx.address);
      const sendable = bal > GAS_RESERVE ? bal - GAS_RESERVE : 0n;
      // native goes LAST
      items.push({ asset: "TON", master: NATIVE, amountRaw: sendable });
    }
    batchId = await startWithdrawalBatch(telegramId, toAddress, items);
    const created = await getBatchItems(batchId);
    pending = created.map((i) => ({ id: i.id, asset: i.asset, master: i.master }));
  }

  // ── Process items in order (jettons first, native last) ────────────────────
  const results: ExitItemResult[] = [];
  for (const item of pending) {
    const r = await processItem(walletCtx, item, toAddress, jettonList);
    results.push(r);
    await sleep(TX_GAP_MS);
  }

  const summary = results
    .filter((r) => r.status === "sent")
    .map((r) => `${r.amount} ${r.asset}`);
  const usdtSent = results
    .filter((r) => r.asset === "USDT" && r.status === "sent")
    .reduce((acc, r) => acc + parseFloat(r.amount), 0);

  console.log(`[EXIT] Complete. Sent: ${summary.join(", ") || "nothing"}`);
  return { usdtSent, summary, batchId, items: results, gasWarning };
}

export interface PreviewItem {
  asset: string;
  master: string;
  amount: string;
}

export interface PreviewResult {
  items: PreviewItem[];
  toAddress: string;
  gasWarning?: string;
}

/** Compute what a withdrawal would send, without sending anything. */
export async function previewExit(
  plan: Plan,
  filter: WithdrawAssetFilter = "all"
): Promise<PreviewResult> {
  if (!hasWithdrawalAddress(plan.ton_address)) {
    throw new Error("Withdrawal address not set");
  }
  const toAddress = plan.ton_address as string;
  const walletCtx = await getUserWalletContext(plan.telegram_id);
  const jettonList = await buildJettonList(walletCtx, filter);

  const items: PreviewItem[] = [];
  for (const t of jettonList) {
    const bal = await getJettonBalanceOnChain(walletCtx, t.master);
    if (bal <= 0n) continue;
    const digits = t.symbol === "USDT" ? 2 : 4;
    items.push({
      asset: t.symbol,
      master: t.master,
      amount: (Number(bal) / Math.pow(10, t.decimals || 9)).toFixed(digits),
    });
  }

  const nativeBal = await getTonBalance(walletCtx.address);
  let gasWarning: string | undefined;
  const need = BigInt(jettonList.length) * GAS_PER_JETTON;
  if (nativeBal < need) {
    gasWarning = `Low gas: wallet holds ${fromNano(nativeBal)} TON, ~${fromNano(need)} needed for token transfers.`;
  }
  if (filter === "all" || filter === "native") {
    const sendable = nativeBal > GAS_RESERVE ? nativeBal - GAS_RESERVE : 0n;
    if (sendable >= MIN_TON_SEND) {
      items.push({ asset: "TON", master: NATIVE, amount: Number(fromNano(sendable)).toFixed(3) });
    }
  }
  return { items, toAddress, gasWarning };
}
