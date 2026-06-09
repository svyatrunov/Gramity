import {
  FREQUENCY_LABELS,
  formatRelativeTime,
  strategyModeLabel,
} from "../../config";
import { StatusBadge, type StatusKind } from "../../components/StatusBadge";
import { LockedAddress } from "../../components/LockedAddress";
import type { PortfolioResponse } from "../../api/portfolio";
import { Skeleton } from "../../components/Skeleton";
import { S } from "../../styles";

function planStatus(plan: NonNullable<PortfolioResponse["plan"]>): {
  status: StatusKind;
  pulse?: boolean;
  label?: string;
} {
  if ((plan.consecutive_failures ?? 0) > 2) {
    return { status: "failed", label: "Ошибка" };
  }
  if (plan.active && plan.is_running) {
    return { status: "running", pulse: true, label: "Выполняется" };
  }
  if (plan.active) {
    return { status: "active", label: "Активна" };
  }
  return { status: "paused", label: "Пауза" };
}

function StrategySkeleton() {
  return (
    <div style={S.card}>
      <Skeleton width="30%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="90%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} style={{ marginBottom: 8 }} />
    </div>
  );
}

export function StrategyCard({
  data,
  loading,
}: {
  data: PortfolioResponse | null;
  loading: boolean;
}) {
  if (loading && !data) return <StrategySkeleton />;

  const plan = data?.plan;
  if (!plan) {
    return (
      <div style={S.card}>
        <div style={S.label}>Стратегия</div>
        <p style={S.hint}>План не найден</p>
      </div>
    );
  }

  const badge = planStatus(plan);
  const freq = FREQUENCY_LABELS[plan.frequency ?? ""] ?? plan.frequency ?? "—";

  return (
    <div style={S.card}>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={S.label}>Стратегия</div>
        <StatusBadge status={badge.status} label={badge.label} pulse={badge.pulse} />
      </div>

      <div style={S.row}>
        <span>Сумма</span>
        <strong>{plan.usdt_amount ?? 0} USDT</strong>
      </div>
      <div style={S.row}>
        <span>Частота</span>
        <span>{freq}</span>
      </div>
      <div style={S.row}>
        <span>Режим</span>
        <span>{strategyModeLabel(plan.strategy_mode)}</span>
      </div>
      <div style={S.row}>
        <span>Следующий цикл</span>
        <span>{formatRelativeTime(plan.next_execution_at)}</span>
      </div>
      <div style={S.row}>
        <span>Циклов</span>
        <span>{plan.cycles_completed ?? 0}</span>
      </div>
      <div style={S.row}>
        <span>Вывод</span>
        <span>
          {plan.withdrawal_address_set && plan.ton_address ? (
            <LockedAddress address={plan.ton_address} />
          ) : (
            <span style={{ color: "#e67e22" }}>⚠️ Укажите адрес вывода</span>
          )}
        </span>
      </div>
    </div>
  );
}
