import {
  ExecutionPhase,
  TradeStatus,
  type Order,
} from "@ston-fi/omniston-sdk";
import { getOmniston, evmAddress } from "./omnistonClient";
import type { EvmChainKey } from "./chains";

export type OrderTrackPhase =
  | "tracking"
  | "disclosing"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface OrderTrackState {
  phase: OrderTrackPhase;
  tradeStatus: string;
  message: string;
  order?: Order;
}

const DISCLOSE_OUTPUT_PHASES = new Set<ExecutionPhase>([
  ExecutionPhase.EXECUTION_PHASE_READY_FOR_PRIVATE_COMPLETION,
  ExecutionPhase.EXECUTION_PHASE_READY_FOR_PUBLIC_COMPLETION,
]);

const TERMINAL_SUCCESS = new Set<string>([
  TradeStatus.TRADE_STATUS_FULLY_FILLED,
  TradeStatus.TRADE_STATUS_PARTIALLY_FILLED,
]);

const TERMINAL_FAILURE = new Set<string>([
  TradeStatus.TRADE_STATUS_CANCELLED,
  TradeStatus.TRADE_STATUS_FAILED,
]);

function phaseLabel(phase?: ExecutionPhase): string {
  switch (phase) {
    case ExecutionPhase.EXECUTION_PHASE_CREATED:
      return "created";
    case ExecutionPhase.EXECUTION_PHASE_READY_FOR_PRIVATE_COMPLETION:
      return "ready for private completion";
    case ExecutionPhase.EXECUTION_PHASE_READY_FOR_PUBLIC_COMPLETION:
      return "ready for public completion";
    case ExecutionPhase.EXECUTION_PHASE_READY_FOR_PRIVATE_ROLLBACK:
      return "ready for rollback";
    case ExecutionPhase.EXECUTION_PHASE_READY_FOR_PUBLIC_ROLLBACK:
      return "ready for public rollback";
    case ExecutionPhase.EXECUTION_PHASE_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_PHASE_ROLLED_BACK:
      return "rolled back";
    default:
      return phase ?? "—";
  }
}

function tradeStatusLabel(status: string): string {
  switch (status) {
    case TradeStatus.TRADE_STATUS_IN_PROGRESS:
      return "In progress";
    case TradeStatus.TRADE_STATUS_FULLY_FILLED:
      return "Fully filled";
    case TradeStatus.TRADE_STATUS_PARTIALLY_FILLED:
      return "Partially filled";
    case TradeStatus.TRADE_STATUS_CANCELLED:
      return "Cancelled";
    case TradeStatus.TRADE_STATUS_FAILED:
      return "Failed";
    default:
      return status;
  }
}

export function buildOrderTrackState(order: Order): OrderTrackState {
  const exec = order.executions[0];
  const inputPhase = exec?.inputPositionPhase;
  const outputPhase = exec?.outputPositionPhase;

  let phase: OrderTrackPhase = "tracking";
  if (order.status === TradeStatus.TRADE_STATUS_FULLY_FILLED) {
    phase = "completed";
  } else if (order.status === TradeStatus.TRADE_STATUS_PARTIALLY_FILLED) {
    phase = "partial";
  } else if (order.status === TradeStatus.TRADE_STATUS_CANCELLED) {
    phase = "cancelled";
  } else if (order.status === TradeStatus.TRADE_STATUS_FAILED) {
    phase = "failed";
  } else if (
    exec &&
    outputPhase &&
    DISCLOSE_OUTPUT_PHASES.has(outputPhase)
  ) {
    phase = "disclosing";
  }

  const parts = [tradeStatusLabel(order.status)];
  if (exec) {
    parts.push(`input: ${phaseLabel(inputPhase)}`);
    if (outputPhase) parts.push(`output: ${phaseLabel(outputPhase)}`);
  }

  return {
    phase,
    tradeStatus: order.status,
    message: parts.join(" · "),
    order,
  };
}

export async function discloseHtlcSecretsForOrder(
  wsUrl: string,
  quoteId: string,
  order: Order,
  secrets: Uint8Array[],
  disclosed: Set<number>
): Promise<number> {
  const omniston = getOmniston(wsUrl);
  let disclosedCount = 0;

  for (const exec of order.executions) {
    if (disclosed.has(exec.index)) continue;

    const outPhase = exec.outputPositionPhase;
    if (!outPhase || !DISCLOSE_OUTPUT_PHASES.has(outPhase)) continue;

    const secret = secrets[exec.index];
    if (!secret) continue;

    await omniston.orderDiscloseHtlcSecret({
      quoteId,
      executionIndex: exec.index,
      secret,
    });
    disclosed.add(exec.index);
    disclosedCount += 1;
  }

  return disclosedCount;
}

export interface TrackCrossChainOrderCallbacks {
  onUpdate: (state: OrderTrackState) => void;
  onComplete: (order: Order) => void;
  onFailed: (order: Order, message: string) => void;
  onError: (err: Error) => void;
}

const ORDER_TRACK_TIMEOUT_MS = 30 * 60 * 1000;

export function trackCrossChainOrder(
  wsUrl: string,
  quoteId: string,
  chainKey: EvmChainKey,
  evmWalletAddress: string,
  htlcSecrets: Uint8Array[],
  callbacks: TrackCrossChainOrderCallbacks
): () => void {
  const omniston = getOmniston(wsUrl);
  const disclosed = new Set<number>();
  let finished = false;

  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    sub.unsubscribe();
    callbacks.onError(new Error("Order tracking timed out (30 min)"));
  }, ORDER_TRACK_TIMEOUT_MS);

  const finish = () => {
    finished = true;
    clearTimeout(timeout);
  };

  const sub = omniston
    .orderTrack({
      quoteId,
      traderAddress: evmAddress(chainKey, evmWalletAddress),
    })
    .subscribe({
      next: async (event) => {
        if (event?.$case !== "order") return;
        const order = event.value;

        try {
          await discloseHtlcSecretsForOrder(
            wsUrl,
            quoteId,
            order,
            htlcSecrets,
            disclosed
          );
        } catch (err) {
          callbacks.onError(
            err instanceof Error ? err : new Error(String(err))
          );
        }

        callbacks.onUpdate(buildOrderTrackState(order));

        if (TERMINAL_SUCCESS.has(order.status)) {
          finish();
          sub.unsubscribe();
          callbacks.onComplete(order);
        } else if (TERMINAL_FAILURE.has(order.status)) {
          finish();
          sub.unsubscribe();
          callbacks.onFailed(order, tradeStatusLabel(order.status));
        }
      },
      error: (err) => {
        finish();
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      },
    });

  return () => {
    finish();
    sub.unsubscribe();
  };
}
