import type { Bot } from "grammy";
import type { GramityContext } from "../context.js";

export interface ExecutionSummary {
  telegramId: number;
  amountUsdt: number;
  lpReceived?: number;
  txSwap?: string | null;
  txStake?: string | null;
  txLp?: string | null;
}

const txLine = (label: string, hash: string | null | undefined): string | null => {
  if (!hash) return null;
  const short = hash.slice(0, 8) + "..." + hash.slice(-6);
  return `🔗 ${label}: [${short}](https://tonviewer.com/transaction/${hash})`;
};

export async function sendExecutionSummary(
  bot: Bot<GramityContext>,
  summary: ExecutionSummary
): Promise<void> {
  const { telegramId, amountUsdt, lpReceived, txSwap, txStake, txLp } = summary;

  const lines: string[] = [
    `⚡ *Gramity сработал — $${amountUsdt.toFixed(2)} в работу*\n`,
  ];

  if (lpReceived) {
    lines.push(`📈 Добавлено в пул: ${lpReceived.toFixed(4)} LP\n`);
  }

  const txLines = [
    txLine("Swap", txSwap),
    txLine("Stake", txStake),
    txLine("LP", txLp),
  ].filter((l): l is string => l !== null);

  if (txLines.length > 0) {
    lines.push(...txLines);
  }

  await bot.api.sendMessage(telegramId, lines.join("\n"), {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
  });
}
