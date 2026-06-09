import type { GramityContext } from "../session.js";
import type { Plan } from "../../db/index.js";
import { getPlanByTelegramId } from "../../db/index.js";
import {
  WITHDRAWAL_CHAINS,
  type WithdrawalChain,
  validateAndCheckAddress,
  saveWithdrawalAddress,
  isWithdrawalAddressSet,
} from "../../constants/chains.js";

export const awaitingWalletData = new Map<
  string,
  {
    chain?: WithdrawalChain;
    step: "awaiting_chain" | "awaiting_address" | "awaiting_confirm";
    pendingAddress?: string;
  }
>();

export async function handleSettingsWallet(ctx: GramityContext, plan?: Plan | null) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const resolvedPlan = plan ?? (await getPlanByTelegramId(telegramId).catch(() => null));
  if (!resolvedPlan) {
    await ctx.reply("Strategy not found.");
    return;
  }

  if (isWithdrawalAddressSet(resolvedPlan)) {
    const chainKey = (resolvedPlan.withdrawal_chain ?? "ton") as WithdrawalChain;
    const chain = WITHDRAWAL_CHAINS[chainKey] ?? WITHDRAWAL_CHAINS.ton;
    const addr = resolvedPlan.ton_address ?? "";
    await ctx.reply(
      `Withdrawal address\n\n` +
        `Chain    ${chain.label}\n` +
        `Token    ${chain.token}\n` +
        `Address  \`${addr.slice(0, 6)}...${addr.slice(-4)}\`\n\n` +
        `Locked. Cannot be changed.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  awaitingWalletData.set(String(telegramId), { step: "awaiting_chain" });

  await ctx.reply("Withdrawal address\n\nWhere to receive funds?", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "TON  →  USD₮", callback_data: "wallet_chain:ton" },
          { text: "Ethereum  →  USD₮", callback_data: "wallet_chain:eth" },
        ],
        [
          { text: "BNB Chain  →  USD₮", callback_data: "wallet_chain:bnb" },
          { text: "Base  →  USDC", callback_data: "wallet_chain:base" },
        ],
        [{ text: "Polygon  →  pUSD", callback_data: "wallet_chain:polygon" }],
      ],
    },
  });
}

export async function handleChainSelected(ctx: GramityContext, chain: WithdrawalChain) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const chainInfo = WITHDRAWAL_CHAINS[chain];
  awaitingWalletData.set(String(telegramId), { chain, step: "awaiting_address" });

  const format =
    chainInfo.address_type === "ton"
      ? "EQ... or UQ... (48 chars)"
      : "0x... (42 chars, hex)";

  await ctx.editMessageText(
    `${chainInfo.label}  →  ${chainInfo.token}\n\nSend your wallet address\nFormat: \`${format}\``,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "← Back", callback_data: "wallet_chain:back" }]],
      },
    }
  );
}

export async function handleAddressInput(
  ctx: GramityContext,
  text: string
): Promise<boolean> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

  const state = awaitingWalletData.get(String(telegramId));
  if (!state || state.step === "awaiting_chain") return false;

  if (state.step === "awaiting_confirm") {
    if (text.toLowerCase() === "confirm" && state.pendingAddress && state.chain) {
      const saved = await saveWithdrawalAddress(
        telegramId,
        state.pendingAddress,
        state.chain
      );
      awaitingWalletData.delete(String(telegramId));

      if (!saved) {
        await ctx.reply("Address already locked.");
        return true;
      }

      const chain = WITHDRAWAL_CHAINS[state.chain];
      await ctx.reply(
        `✅ Withdrawal address set\n\n` +
          `Chain    ${chain.label}\n` +
          `Token    ${chain.token}\n` +
          `Address  \`${state.pendingAddress.slice(0, 6)}...${state.pendingAddress.slice(-4)}\`\n\n` +
          `Locked.`,
        { parse_mode: "Markdown" }
      );
      return true;
    }

    if (!state.chain) return true;
    awaitingWalletData.set(String(telegramId), { ...state, step: "awaiting_address" });
  }

  if (state.step !== "awaiting_address" || !state.chain) return false;

  const trimmed = text.trim();
  const result = await validateAndCheckAddress(trimmed, state.chain);

  if (!result.valid) {
    await ctx.reply(`❌ ${result.error}`);
    return true;
  }

  if (result.warning) {
    awaitingWalletData.set(String(telegramId), {
      ...state,
      step: "awaiting_confirm",
      pendingAddress: trimmed,
    });
    await ctx.reply(
      `⚠️ ${result.warning}\n\nReply \`confirm\` to save, or send a different address.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }

  const saved = await saveWithdrawalAddress(telegramId, trimmed, state.chain);
  awaitingWalletData.delete(String(telegramId));

  if (!saved) {
    await ctx.reply("Address already locked.");
    return true;
  }

  const chain = WITHDRAWAL_CHAINS[state.chain];
  await ctx.reply(
    `✅ Withdrawal address set\n\n` +
      `Chain    ${chain.label}\n` +
      `Token    ${chain.token}\n` +
      `Address  \`${trimmed.slice(0, 6)}...${trimmed.slice(-4)}\`\n\n` +
      `Locked.`,
    { parse_mode: "Markdown" }
  );
  return true;
}
