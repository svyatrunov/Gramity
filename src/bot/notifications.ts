/**
 * Centralized notification message templates.
 * Pure functions — no bot dependency, no I/O.
 */

import { formatGasTopUpMessage } from "../utils/gasLink.js";

export interface CycleCompleteData {
  amountUsdt: number;
  tonAmount: number;
  tsTonAmount: number;
  lpTokensAdded: number;
  txSwap?: string | null;
  txStake?: string | null;
  txLp?: string | null;
  cyclesDone: number;
  totalCycles: number | null;
}

const txLink = (label: string, hash?: string | null): string | null =>
  hash ? `[${label}](https://tonviewer.com/transaction/${hash})` : null;

export const notify = {

  cycleComplete: (data: CycleCompleteData): string => {
    const links = [
      txLink("Swap", data.txSwap),
      txLink("Stake", data.txStake),
      txLink("LP", data.txLp),
    ].filter((l): l is string => l !== null);

    return [
      `✅ *DCA Cycle Complete*`,
      ``,
      `💰 Swapped: $${data.amountUsdt.toFixed(2)} USDT → ${data.tonAmount.toFixed(3)} TON`,
      data.tsTonAmount > 0
        ? `⚡ Staked: ${data.tsTonAmount.toFixed(3)} TON → tsTON`
        : null,
      data.lpTokensAdded > 0 ? `💎 LP added on STON.fi v2` : null,
      `🔒 LP tokens → your wallet`,
      links.length > 0 ? `` : null,
      links.length > 0 ? `🔗 ${links.join(" · ")}` : null,
      ``,
      `_Cycle ${data.cyclesDone}/${data.totalCycles ?? "∞"} complete_`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
  },

  insufficientUsdt: (walletAddress: string, needed: number, have: number): string =>
    `⚠️ *Cycle Skipped — Insufficient Balance*\n\n` +
    `Your agent wallet needs $${needed} USDT for the next cycle.\n` +
    `Current balance: $${have.toFixed(2)} USDT\n\n` +
    `👉 Top up your agent wallet:\n\`${walletAddress}\`\n\n` +
    `_Strategy is paused until funded._`,

  insufficientGas: (walletAddress: string, have: number): string =>
    formatGasTopUpMessage(walletAddress, have),

  autoPaused: (reason: string): string =>
    `⏸ *Strategy Auto-Paused*\n\n` +
    `After 3 consecutive failures (${reason}), your strategy has been paused.\n\n` +
    `Use /resume to restart after topping up.`,

  stepFailed: (stepName: string, error: string): string =>
    `❌ *Cycle Failed at ${stepName}*\n\n` +
    `Error: ${error.slice(0, 200)}\n\n` +
    `The system will retry at next scheduled time.\n` +
    `Contact support if this persists.`,

  allCyclesComplete: (totalInvested: number, lpBalance: string): string =>
    `🎉 *All DCA Cycles Complete!*\n\n` +
    `Total invested: $${totalInvested.toFixed(2)} USDT\n` +
    `LP tokens accumulated: ${lpBalance}\n` +
    `Est. APY earned: ~5.4%\n\n` +
    `Your LP tokens are in your wallet.\n` +
    `Use /status to see your portfolio.`,

  cycleFailed: (error: string): string =>
    `⚠️ *Gramity — cycle error*\n\n` +
    `Reason: ${error.slice(0, 200)}\n\n` +
    `Funds are safe. Next attempt is scheduled.\n` +
    `/status — check position`,
};
