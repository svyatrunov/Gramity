/**
 * /test — runs up to 3 real DCA cycles immediately (no scheduler).
 * Designed for production smoke-testing without touching DEMO_MODE.
 *
 * Failure behaviour:
 *   • Gas < 0.5 TON   → pre-flight blocks execution, "partial" not reached
 *   • Step 1 fails    → status "failed", nothing spent (USDT safe)
 *   • Step 2–4 fail   → status "partial", TON from swap stays in wallet
 *   • USDT shortage   → InsufficientFundsError, plan auto-paused then restored
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
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
import { RAILWAY_PUBLIC_URL } from "../../config.js";

const MINI_APP_URL = `${RAILWAY_PUBLIC_URL}/app`;
export const TEST_CYCLES = 3;

// ─── /test command ─────────────────────────────────────────────────────────

export async function handleTestCommand(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("No strategy set up.\n\nUse /start to create one first.");
    return;
  }

  const depositAddress = await createUserWallet(telegramId).catch(() => "");
  const [usdtBalance, tonNano] = await Promise.all([
    depositAddress ? getUsdtBalance(depositAddress).catch(() => 0) : Promise.resolve(0),
    depositAddress ? getTonBalance(depositAddress).catch(() => 0n) : Promise.resolve(0n),
  ]);
  const tonBalance = Number(tonNano) / 1e9;

  const canAfford = usdtBalance >= plan.usdt_amount;
  const hasGas    = tonBalance >= 0.5;
  const maxRuns   = Math.min(Math.floor(usdtBalance / plan.usdt_amount), TEST_CYCLES);

  const balanceBlock =
    `📊 *Agent wallet status:*\n` +
    `USDT: $${usdtBalance.toFixed(2)} (need $${plan.usdt_amount} / cycle)\n` +
    `TON gas: ${tonBalance.toFixed(3)} TON ${hasGas ? "✅" : "⚠️ low (<0.5)"}\n` +
    (depositAddress ? `Wallet: \`${depositAddress.slice(0, 8)}…${depositAddress.slice(-6)}\`\n` : "");

  const readyBlock = canAfford
    ? `Can run up to *${maxRuns}* cycle(s) with current balance.\n`
    : `❌ *Not enough USDT* — top up before testing.\n`;

  const failGuide =
    `*What each failure looks like:*\n` +
    `• *Low gas (TON)* — cycle skipped, nothing spent, test stops. Top up TON.\n` +
    `• *Step 2–4 fail* — "partial": TON from swap stays in wallet. Not lost — used next cycle.\n` +
    `• *Not enough USDT* — test stops, strategy re-activated automatically.\n` +
    `• *Network error* — cycle logged as failed, test continues.\n\n` +
    `⚠️ *Real mainnet transactions.* Your regular schedule is *not* changed.\n` +
    `Don't forget to check /status after the test.`;

  const kb = new InlineKeyboard()
    .text(`▶️ Run ${TEST_CYCLES} test cycles`, "test_run_confirm")
    .row()
    .text("❌ Cancel", "test_cancel");

  await ctx.reply(
    `🧪 *Test Mode — ${TEST_CYCLES} Immediate DCA Cycles*\n\n` +
      `Runs cycles *right now* without touching the scheduler or other users.\n\n` +
      balanceBlock + "\n" +
      readyBlock + "\n" +
      failGuide,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ─── Confirm callback ──────────────────────────────────────────────────────

export async function handleTestRun(
  telegramId: number,
  reply: (text: string, extra?: object) => Promise<void>,
  cycles = TEST_CYCLES
) {
  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await reply("❌ Plan not found. Use /start to set up a strategy.");
    return;
  }

  const wasActive = plan.active;
  let succeeded = 0;
  let partials  = 0;
  let stopped   = false;

  await reply(
    `🚀 *Running ${cycles} test cycles immediately...*\n\nYou'll get a message after each one.`,
    { parse_mode: "Markdown" }
  );

  for (let i = 1; i <= cycles && !stopped; i++) {
    await reply(`🔄 *Cycle ${i}/${cycles}* — executing...`, { parse_mode: "Markdown" });

    try {
      const result = await executeStrategy(plan);

      if (result.status === "failed") {
        // ── Gas / pre-flight failure ───────────────────────────────────────
        const depositAddress = await createUserWallet(telegramId).catch(() => "");
        const tonNano  = depositAddress ? await getTonBalance(depositAddress).catch(() => 0n) : 0n;
        const tonBal   = Number(tonNano) / 1e9;

        await reply(
          `⛽ *Cycle ${i}/${cycles} — Skipped (low gas)*\n\n` +
            `TON balance: ${tonBal.toFixed(3)} TON\n` +
            `Minimum needed: 0.5 TON for gas\n\n` +
            `Top up the agent wallet:\n` +
            (depositAddress ? `\`${depositAddress}\`\n\n` : "") +
            `No funds were spent. Test stopped — top up TON and retry.`,
          { parse_mode: "Markdown" }
        );
        stopped = true;
        continue;
      }

      const txLinks = [
        result.txSwap  ? `[Swap](https://tonviewer.com/transaction/${result.txSwap})`   : null,
        result.txStake ? `[Stake](https://tonviewer.com/transaction/${result.txStake})` : null,
        result.txLp    ? `[LP](https://tonviewer.com/transaction/${result.txLp})`       : null,
      ].filter((l): l is string => l !== null);

      if (result.status === "partial") {
        // ── Partial: swap succeeded, stake/LP failed ───────────────────────
        partials++;
        await reply(
          `⚡ *Cycle ${i}/${cycles} — Partial*\n\n` +
            `Swap completed: $${result.usdtSpent.toFixed(2)} → ${result.tonReceived.toFixed(3)} TON ✅\n` +
            `Stake/LP: failed ❌\n\n` +
            (txLinks.length ? `🔗 ${txLinks.join(" · ")}\n\n` : "") +
            `_TON stays in agent wallet — not lost._\n` +
            `_Next real cycle will include this TON in the LP step._`,
          { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
        );
      } else {
        // ── Success ────────────────────────────────────────────────────────
        succeeded++;
        await reply(
          `✅ *Cycle ${i}/${cycles} — Success*\n\n` +
            `$${result.usdtSpent.toFixed(2)} USDT spent\n` +
            `${result.tonReceived.toFixed(3)} TON received\n` +
            (result.tstonReceived > 0  ? `${result.tstonReceived.toFixed(3)} tsTON staked ✅\n` : "") +
            (result.lpTokensAdded > 0  ? `LP position added ✅\n`                               : "") +
            (result.lpPositionValue !== "N/A" ? `LP value: ~$${result.lpPositionValue}\n` : "") +
            (txLinks.length ? `\n🔗 ${txLinks.join(" · ")}` : ""),
          { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
        );
      }
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        // ── USDT exhausted ─────────────────────────────────────────────────
        // executeStrategy auto-paused the plan; restore it
        await updatePlan(telegramId, { active: wasActive }).catch(() => {});

        await reply(
          `💸 *Cycle ${i}/${cycles} — Insufficient USDT*\n\n` +
            `Balance:  $${err.balance.toFixed(2)}\n` +
            `Required: $${err.required.toFixed(2)}\n\n` +
            `Test stopped. Strategy is ${wasActive ? "still active ✅" : "paused (was already paused)"}.`,
          { parse_mode: "Markdown" }
        );
        stopped = true;
        continue;
      }

      // ── Unexpected error — log, continue ──────────────────────────────
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[TEST] Cycle ${i} error for user ${telegramId}:`, msg);

      await reply(
        `❌ *Cycle ${i}/${cycles} — Error*\n\n` +
          `\`${msg.slice(0, 300)}\`\n\n` +
          `_Funds are safe. Continuing test..._`,
        { parse_mode: "Markdown" }
      );
    }

    // Brief pause between cycles so TonAPI has time to index the previous tx
    if (i < cycles && !stopped) {
      await new Promise<void>((r) => setTimeout(r, 3_000));
    }
  }

  // Ensure plan state is restored if interrupted
  if (wasActive && !stopped) {
    await updatePlan(telegramId, { active: wasActive }).catch(() => {});
  }

  const dashboardUrl = `${MINI_APP_URL}/dashboard.html#strategy-${plan.id}`;
  const icon = succeeded === cycles ? "🎉" : succeeded > 0 ? "⚠️" : "❌";

  await reply(
    `${icon} *Test complete*\n\n` +
      `✅ ${succeeded} success  ⚡ ${partials} partial  ❌ ${cycles - succeeded - partials} failed\n\n` +
      `Your regular DCA schedule is *unchanged*.\n` +
      `Use /status to check your current position.`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard().webApp("📊 View Dashboard", dashboardUrl),
    }
  );
}
