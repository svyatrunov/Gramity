import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId, getUserWallets, deleteUserAccount } from "../../db/index.js";

export async function handleReset(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const [plan, wallets] = await Promise.all([
    getPlanByTelegramId(telegramId).catch(() => null),
    getUserWallets(telegramId).catch(() => []),
  ]);

  if (!plan && wallets.length === 0) {
    const { clearEvmWalletSessionsForTelegram } =
      await import("../../services/evmWalletSession.js");
    clearEvmWalletSessionsForTelegram(telegramId);
    await ctx.reply("Nothing to delete — EVM sessions cleared.\n\nUse /start to create a strategy.");
    return;
  }

  const kb = new InlineKeyboard()
    .text("🗑 Yes, delete", "confirm_reset")
    .text("❌ Cancel",     "cancel_reset");

  const planLine = plan
    ? `Strategy: $${plan.usdt_amount} | ${plan.frequency}\n`
    : "";
  const walletLine =
    wallets.length > 0
      ? `Deposit wallet: \`${wallets[0].wallet_address.slice(0, 8)}…\`\n`
      : "";

  await ctx.reply(
    `⚠️ *Delete strategy and deposit wallet?*\n\n` +
      planLine +
      walletLine +
      `\nThis removes your Gramity plan and agentic deposit address.\n` +
      `Funds already in LP remain on-chain — use /withdraw if needed.`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

export async function handleResetCallback(ctx: GramityContext, action: "confirm" | "cancel") {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (action === "cancel") {
    await ctx.editMessageText("❌ Deletion cancelled.");
    return;
  }

  try {
    await deleteUserAccount(telegramId);
    const { clearEvmWalletSessionsForTelegram } =
      await import("../../services/evmWalletSession.js");
    clearEvmWalletSessionsForTelegram(telegramId);
    ctx.session.step = "idle";
    await ctx.editMessageText(
      "✅ Strategy and deposit wallet deleted.\n\nUse /start to set up again from scratch."
    );
  } catch (err) {
    await ctx.editMessageText(
      `❌ Error: ${err instanceof Error ? err.message : "unknown"}`
    );
  }
}
