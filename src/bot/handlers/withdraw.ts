/**
 * /withdraw — menu, USDT withdrawal, "withdraw all" trigger.
 * Full-exit (LP remove + unstake) is in src/execution/exit.ts.
 */

import { InlineKeyboard } from "grammy";
import type { GramityContext } from "../session.js";
import { getPlanByTelegramId } from "../../db/index.js";
import { getUsdtBalance } from "../../services/tonapi.js";
import { getUserWalletContext } from "../../services/userWallet.js";
import { sendJettonTransfer } from "../../services/jetton.js";
import { USDT_ADDRESS, USDT_DECIMALS } from "../../config.js";

// ─── /withdraw menu ───────────────────────────────────────────────────────────

export async function handleWithdrawMenu(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("У тебя нет активной стратегии. Используй /start.");
    return;
  }

  let depositAddress = "";
  let usdtBalance = 0;
  try {
    const walletCtx = await getUserWalletContext(telegramId);
    depositAddress = walletCtx.address;
    usdtBalance = await getUsdtBalance(depositAddress);
  } catch {
    await ctx.reply("⚠️ Не удалось загрузить кошелёк. Попробуй позже.");
    return;
  }

  const kb = new InlineKeyboard();

  if (usdtBalance >= 0.01) {
    kb.text(
      `💵 Вывести USDT ($${usdtBalance.toFixed(2)})`,
      "withdraw_usdt_confirm"
    ).row();
  }

  kb.text("📤 Вывести всё (USDT + LP + tsTON)", "withdraw_all_confirm").row();
  kb.text("❌ Отмена", "withdraw_cancel");

  await ctx.reply(
    `💸 *Вывод средств*\n\n` +
      `Депозитный кошелёк:\n\`${depositAddress}\`\n\n` +
      `Свободный USDT: *$${usdtBalance.toFixed(2)}*\n\n` +
      `Куда: \`${plan.ton_address}\`\n\n` +
      `⚠️ _"Вывести всё" выходит из LP и анстейкает tsTON — займёт несколько минут._`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

// ─── Withdraw USDT only ───────────────────────────────────────────────────────

export async function handleWithdrawUsdtConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Стратегия не найдена.");
    return;
  }

  await ctx.reply("⏳ Отправляю USDT на твой кошелёк...");

  try {
    const walletCtx = await getUserWalletContext(telegramId);
    const usdtBalance = await getUsdtBalance(walletCtx.address);

    if (usdtBalance < 0.01) {
      await ctx.reply("⚠️ На кошельке нет USDT для вывода.");
      return;
    }

    const amountRaw = BigInt(
      Math.floor(usdtBalance * Math.pow(10, USDT_DECIMALS))
    );

    await sendJettonTransfer(
      walletCtx,
      USDT_ADDRESS,
      amountRaw,
      plan.ton_address
    );

    await ctx.reply(
      `✅ *$${usdtBalance.toFixed(2)} USDT отправлено*\n\n` +
        `На адрес: \`${plan.ton_address}\`\n\n` +
        `Транзакция появится в эксплорере через 1–2 мин.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[WITHDRAW] USDT error:", err);
    await ctx.reply(
      `❌ Ошибка вывода: ${err instanceof Error ? err.message : "unknown"}`
    );
  }
}

// ─── Withdraw ALL — full exit trigger ─────────────────────────────────────────

export async function handleWithdrawAllConfirm(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const plan = await getPlanByTelegramId(telegramId).catch(() => null);
  if (!plan) {
    await ctx.reply("⚠️ Стратегия не найдена.");
    return;
  }

  // Pause plan so no new cycles start during exit
  const { updatePlan } = await import("../../db/index.js");
  await updatePlan(telegramId, { active: false });

  await ctx.reply(
    `⏳ *Запускаю полный выход из позиции...*\n\n` +
      `1. Убираю ликвидность из пула\n` +
      `2. Анстейкаю tsTON\n` +
      `3. Свапаю всё в USDT\n` +
      `4. Отправляю на твой адрес\n\n` +
      `_Стратегия поставлена на паузу. Это может занять 2–5 минут._`,
    { parse_mode: "Markdown" }
  );

  try {
    const { executeFullExit } = await import("../../execution/exit.js");
    const result = await executeFullExit(plan);

    await ctx.reply(
      `✅ *Выход завершён*\n\n` +
        `Отправлено: *$${result.usdtSent.toFixed(2)} USDT*\n` +
        `На адрес: \`${plan.ton_address}\`\n\n` +
        `_Средства придут через 1–2 мин._`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("[WITHDRAW] Full exit error:", err);
    await ctx.reply(
      `⚠️ *Частичная ошибка при выходе*\n\n` +
        `${err instanceof Error ? err.message : "unknown"}\n\n` +
        `Проверь баланс через /status и попробуй ещё раз.`,
      { parse_mode: "Markdown" }
    );
  }
}
