/**
 * Background USDT deposit detector.
 *
 * After a user is shown the deposit address we start polling TonAPI every 30 s.
 * – On balance ≥ 1 USDT  → send auto-message with "Continue" button and stop.
 * – At 10 min with no deposit → send a gentle reminder.
 * – At 30 min             → give up quietly.
 */

import { getUsdtBalance } from "../services/tonapi.js";
import { InlineKeyboard } from "grammy";

type Sender = (chatId: number, text: string, extra?: object) => Promise<void>;

let _send: Sender | null = null;

export function setPollerSender(fn: Sender): void {
  _send = fn;
}

const POLL_DELAY_MS  = 30_000;
const REMINDER_MS    = 10 * 60_000;
const MAX_POLL_MS    = 30 * 60_000;

const timers           = new Map<number, ReturnType<typeof setTimeout>>();
const starts           = new Map<number, number>();
const reminded         = new Set<number>();
const depositAddresses = new Map<number, string>();
const initialBalances  = new Map<number, number>();

export function startDepositPoller(telegramId: number, depositAddress: string): void {
  stopDepositPoller(telegramId);
  starts.set(telegramId, Date.now());
  depositAddresses.set(telegramId, depositAddress);
  initialBalances.set(telegramId, 0);
  reminded.delete(telegramId);
  scheduleNext(telegramId);
  console.log(`[POLLER] Started for user ${telegramId} → ${depositAddress}`);
}

export function stopDepositPoller(telegramId: number): void {
  const t = timers.get(telegramId);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(telegramId);
  }
  depositAddresses.delete(telegramId);
  initialBalances.delete(telegramId);
}

function scheduleNext(telegramId: number): void {
  timers.set(telegramId, setTimeout(() => tick(telegramId), POLL_DELAY_MS));
}

async function tick(telegramId: number): Promise<void> {
  if (!_send) return;

  const elapsed = Date.now() - (starts.get(telegramId) ?? 0);

  try {
    const depositAddress = depositAddresses.get(telegramId) ?? "";
    const balance        = depositAddress ? await getUsdtBalance(depositAddress) : 0;

    if (balance >= 1) {
      stopDepositPoller(telegramId);
      console.log(`[POLLER] Deposit detected for ${telegramId}: $${balance.toFixed(2)}`);

      const depositAddress = depositAddresses.get(telegramId) ?? "";
      if (depositAddress) {
        const { seedGasIfNeeded } = await import("../services/gasSeed.js");
        seedGasIfNeeded(depositAddress).catch((err) =>
          console.warn("[POLLER] gas seed:", (err as Error).message)
        );
      }

      const prevBalance   = initialBalances.get(telegramId) ?? 0;
      const depositAmount = (balance - prevBalance).toFixed(2);
      await _send(
        telegramId,
        `Deposit received\n\n` +
          `$${depositAmount} USDT on agent wallet.`,
        { parse_mode: "Markdown" }
      );

      const kb = new InlineKeyboard()
        .text("Run now", "deposit_done")
        .text("Status", "status_check");
      await _send(telegramId, "Continue setup", { reply_markup: kb });
      return;
    }

    if (!reminded.has(telegramId) && elapsed >= REMINDER_MS) {
      reminded.add(telegramId);
      await _send(
        telegramId,
        `⏳ Still waiting for USDT on the deposit wallet...\n\n` +
          `TON transactions take 1–2 min. Just wait a moment 🙏\n` +
          `To cancel — /cancel`
      );
    }

    if (elapsed < MAX_POLL_MS) {
      scheduleNext(telegramId);
    } else {
      console.log(`[POLLER] Timed out for user ${telegramId}`);
    }
  } catch {
    if (Date.now() - (starts.get(telegramId) ?? 0) < MAX_POLL_MS) {
      scheduleNext(telegramId);
    }
  }
}
