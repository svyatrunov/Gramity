/**
 * /withdraw — menu, USDT withdrawal, "withdraw all" trigger.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId } from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { getUserWalletContext } from "../../services/userWallet.js";
import { sendJettonTransfer } from "../../services/jetton.js";
import { USDT_ADDRESS, USDT_DECIMALS } from "../../config.js";

export async function handleWithdrawMenu(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("No active strategy. Use /start.");
    return;
  }

  let depositAddress = "";
  let usdtBalance    = 0;
  try {
    const walletCtx = await getUserWalletContext(telegramId);
    depositAddress  = walletCtx.address;
    usdtBalance     = await getUsdtBalance(depositAddress);
  } catch {
    await ctx.reply("⚠️ Could not load wallet. Please try again later.");
    return;
  }

  const kb = new InlineKeyboard();

  if (usdtBalance >= 0.01) {
    kb.text(
      `💵 Withdraw USDT ($${usdtBalance.toFixed(2)})`,
      "withdraw_usdt_confirm"
    ).row();
  }

  kb.text("📤 Withdraw everything (USDT + LP + tsTON)", "withdraw_all_confirm").row();
  kb.text("❌ Cancel", "withdraw_cancel");

  await ctx.reply(
    `💸 *Withdraw Funds*\n\n` +
      `Deposit wallet:\n\`${depositAddress}\`\n\n` +
      `Available USDT: *$${usdtBalance.toFixed(2)}*\n\n` +
      `Destination: \`${plan.ton_address}\`\n\n` +
      `⚠️ _"Withdraw everything" exits LP and unstakes tsTON — takes a few minutes._`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleWithdrawUsdtConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Strategy not found.");
    return;
  }

  await ctx.reply("⏳ Sending USDT to your wallet...");

  try {
    const walletCtx  = await getUserWalletContext(telegramId);
    const usdtBalance = await getUsdtBalance(walletCtx.address);

    if (usdtBalance < 0.01) {
      await ctx.reply("⚠️ No USDT available to withdraw.");
      return;
    }

    const amountRaw = BigInt(
      Math.floor(usdtBalance * Math.pow(10, USDT_DECIMALS))
    );

    await sendJettonTransfer(walletCtx, USDT_ADDRESS, amountRaw, plan.ton_address);

    await ctx.reply(
      `✅ *$${usdtBalance.toFixed(2)} USDT sent*\n\n` +
        `To: \`${plan.ton_address}\`\n\n` +
        `Transaction will appear in the explorer in 1–2 min.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[WITHDRAW] USDT error:", err);
    await ctx.reply(
      `❌ Withdrawal error: ${err instanceof Error ? err.message : "unknown"}`
    );
  }
}

export async function handleWithdrawAllConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Strategy not found.");
    return;
  }

  const { updatePlan } = await import("../../db/index.js");
  await updatePlan(telegramId, { active: false });

  await ctx.reply(
    `⏳ *Starting full exit from position...*\n\n` +
      `1. Removing liquidity from pool\n` +
      `2. Unstaking tsTON\n` +
      `3. Swapping everything to USDT\n` +
      `4. Sending to your address\n\n` +
      `_Strategy paused. This may take 2–5 minutes._`,
    { parse_mode: "Markdown" }
  );

  try {
    const { executeFullExit } = await import("../../execution/exit.js");
    const result = await executeFullExit(plan);

    await ctx.reply(
      `✅ *Exit complete*\n\n` +
        `Sent: *$${result.usdtSent.toFixed(2)} USDT*\n` +
        `To: \`${plan.ton_address}\`\n\n` +
        `_Funds will arrive in 1–2 min._`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[WITHDRAW] Full exit error:", err);
    await ctx.reply(
      `⚠️ *Partial error during exit*\n\n` +
        `${err instanceof Error ? err.message : "unknown"}\n\n` +
        `Check your balance via /status and try again.`,
      { parse_mode: "Markdown" }
    );
  }
}
