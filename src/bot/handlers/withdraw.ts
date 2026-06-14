/**
 * /withdraw — USDT withdrawal by chain.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../context.js";
import { getPlanByTelegramId } from "../../db/index.js";
import { getUsdtBalance, getLastTxHash } from "../../services/tonapi.js";
import { getUserWalletContext } from "../../services/userWallet.js";
import { sendJettonTransfer } from "../../services/jetton.js";
import { USDT_ADDRESS, USDT_DECIMALS } from "../../config.js";
import {
  WITHDRAWAL_CHAINS,
  type WithdrawalChain,
  isWithdrawalAddressSet,
} from "../../constants/chains.js";

export async function handleWithdrawMenu(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("No active strategy. Use /start.");
    return;
  }

  if (!isWithdrawalAddressSet(plan)) {
    await ctx.reply("No withdrawal address\n\nSet a destination wallet first.", {
      reply_markup: {
        inline_keyboard: [[{ text: "Set wallet", callback_data: "settings:wallet" }]],
      },
    });
    return;
  }

  let balance = 0;
  try {
    const walletCtx = await getUserWalletContext(telegramId);
    balance = await getUsdtBalance(walletCtx.address);
  } catch {
    await ctx.reply("Could not load wallet. Try again later.");
    return;
  }

  if (balance < 0.01) {
    await ctx.reply("Balance: $0.00. Nothing to withdraw.");
    return;
  }

  const chainKey = (plan.withdrawal_chain ?? "ton") as WithdrawalChain;
  const chain = WITHDRAWAL_CHAINS[chainKey] ?? WITHDRAWAL_CHAINS.ton;
  const addr = plan.ton_address ?? "";
  const addrShort = `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  if (chain.address_type === "ton") {
    await ctx.reply(
      `Withdraw USDT\n\n` +
        `Amount   *$${balance.toFixed(2)} USDT*\n` +
        `To       \`${addrShort}\`\n` +
        `Network  TON\n\n` +
        `Funds arrive within 1 minute.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `Withdraw $${balance.toFixed(2)}`,
                callback_data: "withdraw:usdt:confirm",
              },
              { text: "Cancel", callback_data: "withdraw:cancel" },
            ],
          ],
        },
      }
    );
    return;
  }

  await ctx.reply(
    `Withdraw to ${chain.label}\n\n` +
      `You get   *${chain.token}* on ${chain.label}\n` +
      `To        \`${addrShort}\`\n` +
      `Amount    $${balance.toFixed(2)} USDT\n\n` +
      `Step 1   Withdraw USDT to a TON wallet:\n` +
      `/withdraw\\_ton\n\n` +
      `Step 2   Bridge at omniston.ston.fi\n` +
      `TON → ${chain.label} · ${chain.token}`,
    { parse_mode: "Markdown" }
  );
}

export async function handleWithdrawUsdtConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("Strategy not found.");
    return;
  }
  if (!isWithdrawalAddressSet(plan)) {
    await ctx.reply("No withdrawal address\n\nSet a destination wallet first.", {
      reply_markup: {
        inline_keyboard: [[{ text: "Set wallet", callback_data: "settings:wallet" }]],
      },
    });
    return;
  }

  const dest = plan.ton_address;
  if (!dest) return;

  try {
    await ctx.editMessageText("Processing...");
  } catch {
    await ctx.reply("Processing...");
  }

  try {
    const walletCtx = await getUserWalletContext(telegramId);
    const usdtBalance = await getUsdtBalance(walletCtx.address);

    if (usdtBalance < 0.01) {
      await ctx.editMessageText("Balance: $0.00. Nothing to withdraw.");
      return;
    }

    const amountRaw = BigInt(
      Math.floor(usdtBalance * Math.pow(10, USDT_DECIMALS))
    );

    await sendJettonTransfer(walletCtx, USDT_ADDRESS, amountRaw, dest);

    const txHash = await getLastTxHash(walletCtx.address, 5_000);
    const txLink = txHash
      ? `\n\n[View on-chain](https://tonviewer.com/transaction/${txHash})`
      : "";

    await ctx.editMessageText(
      `✅ Withdrawal sent\n\nFunds will arrive within 1 minute.${txLink}`,
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    );
  } catch (err) {
    console.error("[WITHDRAW] USDT error:", err);
    const msg = err instanceof Error ? err.message : "Try again.";
    try {
      await ctx.editMessageText(`❌ Withdrawal failed\n\n${msg}`);
    } catch {
      await ctx.reply(`❌ Withdrawal failed\n\n${msg}`);
    }
  }
}

export async function handleWithdrawCancel(ctx: GramityContext) {
  try {
    await ctx.editMessageText("Cancelled.");
  } catch {
    await ctx.reply("Cancelled.");
  }
}

export async function handleWithdrawAdvancedMenu(ctx: GramityContext) {
  await handleWithdrawMenu(ctx);
}

export async function handleWithdrawLpConfirm(ctx: GramityContext) {
  await ctx.reply("Use /withdraw for USDT withdrawal.");
}

export async function handleWithdrawAllConfirm(ctx: GramityContext) {
  await ctx.reply("Use /withdraw for USDT withdrawal.");
}
