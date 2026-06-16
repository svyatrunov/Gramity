/**
 * Checkpoint — persists DCA cycle state to disk so a restart
 * resumes from the last completed step instead of re-sending transactions.
 *
 * File: gramity-state.json (in project root, never committed).
 */

import * as fs from "fs";
import * as path from "path";
import type { SplitResult } from "./step2-split.js";

const STATE_FILE = path.resolve(process.cwd(), "gramity-state.json");

export interface CycleState {
  /** Unix timestamp (ms) when this cycle was started */
  startedAt: number;
  /** Step last successfully completed: 0 = none, 1-5 = step N done */
  completedStep: 0 | 1 | 2 | 3 | 4 | 5;

  // Results carried forward between steps
  tonReceived?: string;       // bigint as string (nanoton)
  splitInfo?: {
    stakeAmount: string;
    keepAmount: string;
    poolRatio: number;
    tsTONRate: number;
    poolAddress: string;
    token0Address: string;
    token1Address: string;
    reserve0: string;
    reserve1: string;
  };
  tsTonReceived?: string;     // bigint as string
  tsTonAddress?: string;
  exchangeRate?: number;
  lpTokensReceived?: string;  // bigint as string
  poolSharePct?: string;
}

export function loadState(): CycleState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw) as CycleState;
  } catch {
    return null;
  }
}

export function saveState(state: CycleState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function clearState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch {}
}

/** Rehydrate SplitResult bigints from the checkpoint */
export function splitInfoFromState(
  s: NonNullable<CycleState["splitInfo"]>
): SplitResult {
  return {
    stakeAmount: BigInt(s.stakeAmount),
    keepAmount: BigInt(s.keepAmount),
    poolRatio: s.poolRatio,
    tsTONRate: s.tsTONRate,
    poolAddress: s.poolAddress,
    token0Address: s.token0Address,
    token1Address: s.token1Address,
    reserve0: BigInt(s.reserve0),
    reserve1: BigInt(s.reserve1),
  };
}
