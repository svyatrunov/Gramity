import { GAS_RESERVE_TON } from "../constants/dca.js";

/** Tonkeeper universal link — opens STON Wallet / Tonkeeper on mobile for a TON transfer. */
export function buildTonTransferUrl(
  address: string,
  amountTon: number = GAS_RESERVE_TON,
  text = "Gramity gas"
): string {
  const nano = Math.round(amountTon * 1e9);
  const params = new URLSearchParams({
    amount: String(nano),
    text,
  });
  return `https://app.tonkeeper.com/transfer/${encodeURIComponent(address)}?${params}`;
}

export function formatGasTopUpMessage(
  walletAddress: string,
  haveTon?: number
): string {
  const balLine =
    haveTon != null ? `Current: ${haveTon.toFixed(3)} TON\n\n` : "";
  return (
    `⛽ *Low Gas — Cycle Skipped*\n\n` +
    `Send ~${GAS_RESERVE_TON} TON from STON Wallet to your DCA wallet:\n` +
    `\`${walletAddress}\`\n\n` +
    balLine +
    `_Open STON Wallet → Send → paste the address above._`
  );
}

export async function buildBridgeCompleteMessage(telegramId: number): Promise<{
  text: string;
  gasButtonUrl?: string;
}> {
  const { createUserWallet } = await import("../services/userWallet.js");
  const { getPlanByTelegramId } = await import("../db/index.js");
  const { getTonBalance } = await import("../services/tonapi.js");
  const { hasWithdrawalAddress } = await import("./tonAddress.js");

  const agentAddress = await createUserWallet(telegramId);
  const plan = await getPlanByTelegramId(telegramId).catch(() => null);

  let tonBalance = 0;
  try {
    tonBalance = Number(await getTonBalance(agentAddress)) / 1e9;
  } catch {
    tonBalance = 0;
  }

  const needsGas = tonBalance < GAS_RESERVE_TON;
  const needsWithdrawal = plan != null && !hasWithdrawalAddress(plan.ton_address);

  const lines = [
    `✅ *USDT arrived on TON*`,
    ``,
    `DCA wallet:\n\`${agentAddress}\``,
    ``,
  ];

  if (needsGas) {
    lines.push(
      `⛽ *Next step:* send ~${GAS_RESERVE_TON} TON for gas from STON Wallet to the address above.`,
      ``
    );
  }

  if (needsWithdrawal) {
    lines.push(
      `📬 *Set withdrawal wallet* in the Mini App — cycles won't run without it.`,
      ``
    );
  }

  if (!needsGas && !needsWithdrawal) {
    lines.push(`_DCA cycles will run on your schedule._`, ``);
  } else if (plan) {
    lines.push(`_Then DCA runs ${plan.frequency} as configured._`, ``);
  }

  lines.push(`📊 /status · Dashboard in Mini App`);

  return {
    text: lines.join("\n"),
    gasButtonUrl: needsGas ? buildTonTransferUrl(agentAddress) : undefined,
  };
}
