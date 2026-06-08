/**
 * /withdraw — menu, USDT withdrawal, LP tokens withdrawal, "withdraw all" trigger.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId } from "../../db/index.js";
import { getUsdtBalance, getLastTxHash } from "../../services/tonapi.js";
import { getUserWalletContext } from "../../services/userWallet.js";
import { sendJettonTransfer } from "../../services/jetton.js";
import { USDT_ADDRESS, USDT_DECIMALS, POOL_ADDRESS } from "../../config.js";
import { Address, JettonMaster, JettonWallet, fromNano } from "@ton/ton";
import { hasWithdrawalAddress } from "../../utils/tonAddress.js";

async function getLpBalance(
  walletAddress: string,
  poolAddress: string,
  client: import("@ton/ton").TonClient
): Promise<bigint> {
  try {
    const lpMaster = client.open(JettonMaster.create(Address.parse(poolAddress)));
    const lpWalletAddr = await lpMaster.getWalletAddress(Address.parse(walletAddress));
    const lpWallet = client.open(JettonWallet.create(lpWalletAddr));
    return await lpWallet.getBalance();
  } catch {
    return 0n;
  }
}

export async function handleWithdrawMenu(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("No active strategy. Use /start.");
    return;
  }
  if (!hasWithdrawalAddress(plan.ton_address)) {
    await ctx.reply(
      "⚠️ *No withdrawal address set*\n\n" +
        "Open the Mini App to set your TON withdrawal wallet before withdrawing.",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const withdrawalAddress = plan.ton_address;

  let depositAddress = "";
  let usdtBalance    = 0;
  let lpBalance      = 0n;
  try {
    const walletCtx = await getUserWalletContext(telegramId);
    depositAddress  = walletCtx.address;
    usdtBalance     = await getUsdtBalance(depositAddress);
    if (POOL_ADDRESS) {
      lpBalance = await getLpBalance(depositAddress, POOL_ADDRESS, walletCtx.client as import("@ton/ton").TonClient);
    }
  } catch {
    await ctx.reply("⚠️ Could not load wallet. Please try again later.");
    return;
  }

  const lpHuman = lpBalance > 0n ? Number(fromNano(lpBalance)) : 0;

  const kb = new InlineKeyboard();

  if (usdtBalance >= 0.01) {
    kb.text(
      `💵 Withdraw USDT ($${usdtBalance.toFixed(2)})`,
      "withdraw_usdt_confirm"
    ).row();
  }

  if (lpHuman > 0) {
    kb.text(
      `💎 Withdraw LP tokens (${lpHuman.toFixed(4)} LP)`,
      "withdraw_lp_confirm"
    ).row();
  }

  kb.text("📤 Withdraw everything (USDT + LP + tsTON)", "withdraw_all_confirm").row();
  kb.text("❌ Cancel", "withdraw_cancel");

  const lpLine = lpHuman > 0 ? `\nLP tokens: *${lpHuman.toFixed(4)} LP*` : "";

  await ctx.reply(
    `💸 *Withdraw Funds*\n\n` +
      `Deposit wallet:\n\`${depositAddress}\`\n\n` +
      `Available USDT: *$${usdtBalance.toFixed(2)}*${lpLine}\n\n` +
      `Destination: \`${withdrawalAddress}\`\n\n` +
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
  if (!hasWithdrawalAddress(plan.ton_address)) {
    await ctx.reply(
      "⚠️ *No withdrawal address set*\n\nOpen the Mini App to set your TON withdrawal wallet.",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const dest = plan.ton_address;

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

    await sendJettonTransfer(walletCtx, USDT_ADDRESS, amountRaw, dest);

    await ctx.reply(
      `✅ *$${usdtBalance.toFixed(2)} USDT sent*\n\n` +
        `To: \`${dest}\`\n\n` +
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

export async function handleWithdrawLpConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Strategy not found.");
    return;
  }

  if (!hasWithdrawalAddress(plan.ton_address)) {
    await ctx.reply(
      "⚠️ *No withdrawal address set*\n\nOpen the Mini App to set your TON withdrawal wallet.",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const withdrawalAddress = plan.ton_address;

  await ctx.reply(
    `⏳ *Starting LP withdrawal...*\n\n` +
      `Removing liquidity from STON.fi v2\n` +
      `Sending to: \`${withdrawalAddress}\`\n\n` +
      `_This may take 1–3 minutes._`,
    { parse_mode: "Markdown" }
  );

  try {
    const { executeFullExit } = await import("../../execution/exit.js");
    const walletCtx = await getUserWalletContext(telegramId);

    const result = await executeFullExit(plan);

    // Grab the latest tx hash after exit completes
    const txHash = await getLastTxHash(walletCtx.address, 3_000);
    const txLink = txHash
      ? `\n\n🔗 [View on-chain](https://tonviewer.com/transaction/${txHash})`
      : "";

    await ctx.reply(
      `✅ *LP Withdrawal Complete*\n\n` +
        `Sent to: \`${withdrawalAddress}\`\n` +
        (result.summary.length > 0 ? `Assets: ${result.summary.join(", ")}\n` : "") +
        txLink,
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
    );
  } catch (err) {
    console.error("[WITHDRAW] LP exit error:", err);
    await ctx.reply(
      `⚠️ *Error during LP withdrawal*\n\n` +
        `${err instanceof Error ? err.message : "unknown"}\n\n` +
        `Check your balance via /status and try again.`,
      { parse_mode: "Markdown" }
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

  if (!hasWithdrawalAddress(plan.ton_address)) {
    await ctx.reply(
      "⚠️ *No withdrawal address set*\n\nOpen the Mini App to set your TON withdrawal wallet.",
      { parse_mode: "Markdown" }
    );
    return;
  }
  const withdrawalAddress = plan.ton_address;

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
        `To: \`${withdrawalAddress}\`\n\n` +
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
