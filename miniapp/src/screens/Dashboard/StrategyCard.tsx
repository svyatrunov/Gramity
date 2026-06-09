import {
  FREQUENCY_LABELS,
  formatRelativeTime,
  strategyModeLabel,
} from "../../config";
import {
  STRATEGY_TYPE_LABELS,
  type StrategyInfo,
} from "../../api/strategies";
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

function strategyRowStatus(s: StrategyInfo): {
  status: StatusKind;
  label: string;
} {
  if (s.status === "active") return { status: "active", label: "Активна" };
  if (s.status === "paused") return { status: "paused", label: "Пауза" };
  return { status: "failed", label: "Остановлена" };
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

function LegacyPlanCard({ plan }: { plan: NonNullable<PortfolioResponse["plan"]> }) {
  const badge = planStatus(plan);
  const freq = FREQUENCY_LABELS[plan.frequency ?? ""] ?? plan.frequency ?? "—";

  return (
    <>
      <div style={{ ...S.row, marginBottom: 12 }}>
        <div style={S.label}>Стратегия (legacy)</div>
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
    </>
  );
}

function MultiStrategyRow({ s }: { s: StrategyInfo }) {
  const badge = strategyRowStatus(s);
  const freq = FREQUENCY_LABELS[s.frequency] ?? s.frequency;

  return (
    <div
      style={{
        ...S.card,
        marginBottom: 8,
        padding: 12,
        background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
      }}
    >
      <div style={{ ...S.row, marginBottom: 8 }}>
        <strong>#{s.id} {STRATEGY_TYPE_LABELS[s.strategy_type]}</strong>
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
      <div style={S.row}>
        <span>Сумма</span>
        <span>{s.amount_usdt} USDT</span>
      </div>
      <div style={S.row}>
        <span>Частота</span>
        <span>{freq}</span>
      </div>
      {s.strategy_type === "dca_lp" && (
        <div style={S.row}>
          <span>LP</span>
          <span>{s.output_mode === "reinvest" ? "Reinvest" : "Withdraw"}</span>
        </div>
      )}
      <div style={S.row}>
        <span>Следующий запуск</span>
        <span>{formatRelativeTime(s.next_run_at ?? undefined)}</span>
      </div>
      <div style={S.row}>
        <span>Циклов</span>
        <span>{s.total_cycles}</span>
      </div>
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

  const strategies = data?.strategies ?? [];
  const plan = data?.plan;

  if (strategies.length === 0 && !plan) {
    return (
      <div style={S.card}>
        <div style={S.label}>Стратегии</div>
        <p style={S.hint}>План не найден — создайте через onboarding или /add в боте</p>
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={S.label}>Стратегии</div>
      {strategies.length > 0
        ? strategies.map((s) => <MultiStrategyRow key={s.id} s={s} />)
        : plan && <LegacyPlanCard plan={plan} />}
    </div>
  );
}
