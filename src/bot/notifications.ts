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

export const notify = {
  cycleComplete: (data: CycleCompleteData): string =>
    [
      `Cycle complete`,
      ``,
      `$${data.amountUsdt.toFixed(2)} USDT → LP on STON.fi`,
      `swap · stake · lp`,
    ].join("\n"),

  insufficientUsdt: (walletAddress: string, needed: number, have: number): string =>
    `Cycle skipped\n\n` +
    `Insufficient USDT on agent wallet.\n` +
    `Have     *$${have.toFixed(2)}*\n` +
    `Need     *$${needed.toFixed(2)}*\n\n` +
    `Deposit address:\n\`${walletAddress}\``,

  insufficientGas: (walletAddress: string, have: number): string =>
    formatGasTopUpMessage(walletAddress, have),

  autoPaused: (reason: string): string =>
    `Strategy paused\n\n` +
    `After 3 consecutive failures (${reason}).\n\n` +
    `Use /resume after topping up.`,

  stepFailed: (stepName: string, error: string): string =>
    `Cycle failed\n\n` +
    `Reason   ${error.slice(0, 200)}\n\n` +
    `Next attempt at scheduled time.`,

  allCyclesComplete: (totalInvested: number, lpBalance: string): string =>
    `All cycles complete\n\n` +
    `Invested   *$${totalInvested.toFixed(2)}* USDT\n` +
    `LP tokens  ${lpBalance}\n\n` +
    `Use /status to see your portfolio.`,

  cycleFailed: (error: string): string =>
    `Cycle failed\n\n` +
    `Reason   ${error.slice(0, 200)}`,
};
