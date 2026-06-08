/**
 * Immediate DCA cycles (Dashboard → POST /api/run-now).
 * Does not touch the scheduler or change next_execution_at.
 */

import {
  getPlanByTelegramId,
  updatePlan,
} from "../../db/index.js";
import {
  executeStrategy,
  InsufficientFundsError,
} from "../../execution/index.js";
import {
  getUsdtBalance,
  getTonBalance,
} from "../../services/tonapi.js";
import { createUserWallet } from "../../services/userWallet.js";
import { GAS_RESERVE_TON } from "../../constants/dca.js";

export const MAX_RUN_CYCLES = 3;

export async function handleRunNow(
  telegramId: number,
  reply: (text: string, extra?: object) => Promise<void>,
  cycles = 1
) {
  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await reply("❌ No strategy found. Complete onboarding in the Mini App first.");
    return;
  }

  const runs = Math.min(Math.max(cycles, 1), MAX_RUN_CYCLES);
  const wasActive = plan.active;

  await reply(
    `⚡ *Running ${runs} DCA cycle${runs > 1 ? "s" : ""} now…*\n\n` +
      `_Real mainnet. Schedule unchanged._`,
    { parse_mode: "Markdown" }
  );

  let stopped = false;
  let partials = 0;

  for (let i = 1; i <= runs && !stopped; i++) {
    await reply(`🔄 *Cycle ${i}/${runs}* — executing…`, { parse_mode: "Markdown" });

    try {
      const result = await executeStrategy(plan);

      if (result.status === "failed") {
        const depositAddress = await createUserWallet(telegramId).catch(() => "");
        const tonNano = depositAddress ? await getTonBalance(depositAddress).catch(() => 0n) : 0n;
        const tonBal = Number(tonNano) / 1e9;

        await reply(
          `⛽ *Cycle ${i}/${runs} — skipped (low gas)*\n\n` +
            `TON balance: ${tonBal.toFixed(3)} TON (need ${GAS_RESERVE_TON})\n\n` +
            (depositAddress ? `DCA wallet:\n\`${depositAddress}\`\n\n` : "") +
            `No funds spent.`,
          { parse_mode: "Markdown" }
        );
        stopped = true;
        continue;
      }

      const txLinks = [
        result.txSwap ? `[Swap](https://tonviewer.com/transaction/${result.txSwap})` : null,
        result.txStake ? `[Stake](https://tonviewer.com/transaction/${result.txStake})` : null,
        result.txLp ? `[LP](https://tonviewer.com/transaction/${result.txLp})` : null,
      ].filter((l): l is string => l !== null);

      if (result.status === "partial") {
        partials++;
        await reply(
          `⚡ *Cycle ${i}/${runs} — partial*\n\n` +
            `Swap: $${result.usdtSpent.toFixed(2)} → ${result.tonReceived.toFixed(3)} TON ✅\n` +
            `Stake/LP: skipped\n\n` +
            (txLinks.length ? `🔗 ${txLinks.join(" · ")}\n\n` : "") +
            `_TON stays on DCA wallet — not lost._`,
          { parse_mode: "Markdown" }
        );
        continue;
      }

      await reply(
        `✅ *Cycle ${i}/${runs} complete*\n\n` +
          `$${result.usdtSpent.toFixed(2)} USDT → LP on STON.fi\n\n` +
          (txLinks.length ? `🔗 ${txLinks.join(" · ")}` : ""),
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
      );
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        await reply(
          `⚠️ *Cycle ${i}/${runs} — insufficient USDT*\n\n` +
            `Have $${err.balance.toFixed(2)}, need $${err.required}.`,
          { parse_mode: "Markdown" }
        );
        stopped = true;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        await reply(`❌ Cycle ${i}/${runs} failed: ${msg.slice(0, 200)}`);
        stopped = true;
      }
    }
  }

  if (!wasActive) {
    await updatePlan(telegramId, { active: false }).catch(() => {});
  }

  const summary =
    partials > 0
      ? `${partials} partial cycle(s). Check /status.`
      : stopped
        ? "Stopped early. Check /status."
        : `All ${runs} cycle(s) done. /status — view position`;

  await reply(`📊 *Done.* ${summary}`, { parse_mode: "Markdown" });
}
