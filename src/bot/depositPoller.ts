/**
 * Background USDT deposit detector.
 *
 * After a user is shown the deposit address we start polling TonAPI every 30 s.
 * – On balance ≥ 1 USDT  → send auto-message with "Continue" button and stop.
 * – At 10 min with no deposit → send a gentle reminder.
 * – At 30 min             → give up quietly.
 *
 * The Telegram sender is injected by bot/index.ts to avoid circular deps.
 */

import { getUsdtBalance } from "../services/tonapi.js";
import { InlineKeyboard } from "grammy";

type Sender = (chatId: number, text: string, extra?: object) => Promise<void>;

let _send: Sender | null = null;

/** Inject bot.api.sendMessage — called once from bot/index.ts */
export function setPollerSender(fn: Sender): void {
  _send = fn;
}

// ── Timing constants ──────────────────────────────────────────────────────────
const POLL_DELAY_MS = 30_000;      // check every 30 s
const REMINDER_MS = 10 * 60_000;   // remind after 10 min silence
const MAX_POLL_MS = 30 * 60_000;   // give up after 30 min

// ── Per-user state ─────────────────────────────────────────────────────────────
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const starts = new Map<number, number>();
const reminded = new Set<number>();
const depositAddresses = new Map<number, string>();

// ── Public API ─────────────────────────────────────────────────────────────────

export function startDepositPoller(telegramId: number, depositAddress: string): void {
  stopDepositPoller(telegramId);
  starts.set(telegramId, Date.now());
  depositAddresses.set(telegramId, depositAddress);
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
}

// ── Internals ─────────────────────────────────────────────────────────────────

function scheduleNext(telegramId: number): void {
  timers.set(telegramId, setTimeout(() => tick(telegramId), POLL_DELAY_MS));
}

async function tick(telegramId: number): Promise<void> {
  if (!_send) return;

  const elapsed = Date.now() - (starts.get(telegramId) ?? 0);

  try {
    const depositAddress = depositAddresses.get(telegramId) ?? "";
    const balance = depositAddress ? await getUsdtBalance(depositAddress) : 0;

    if (balance >= 1) {
      stopDepositPoller(telegramId);
      console.log(`[POLLER] Deposit detected for ${telegramId}: $${balance.toFixed(2)}`);

      const kb = new InlineKeyboard().text("→ Выбрать сумму", "deposit_done");
      await _send(
        telegramId,
        `✅ *Получено ${balance.toFixed(2)} USDT!*\n\nДеньги на месте — продолжаем 👇`,
        { parse_mode: "Markdown", reply_markup: kb }
      );
      return;
    }

    // 10-min nudge
    if (!reminded.has(telegramId) && elapsed >= REMINDER_MS) {
      reminded.add(telegramId);
      await _send(
        telegramId,
        `⏳ Всё ещё жду USDT на депозитный кошелёк...\n\n` +
          `Транзакции TON занимают 1–2 мин. Просто подожди 🙏\n` +
          `Чтобы отменить — /cancel`
      );
    }

    if (elapsed < MAX_POLL_MS) {
      scheduleNext(telegramId);
    } else {
      console.log(`[POLLER] Timed out for user ${telegramId}`);
    }
  } catch {
    // Transient error — retry next tick if within window
    if (Date.now() - (starts.get(telegramId) ?? 0) < MAX_POLL_MS) {
      scheduleNext(telegramId);
    }
  }
}
