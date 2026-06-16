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
    <div className="g-card">
      <Skeleton width="30%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="90%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} />
    </div>
  );
}

function LegacyPlanCard({ plan }: { plan: NonNullable<PortfolioResponse["plan"]> }) {
  const badge = planStatus(plan);
  const freq = FREQUENCY_LABELS[plan.frequency ?? ""] ?? plan.frequency ?? "—";

  return (
    <div>
      <div className="g-row" style={{ borderTop: "none", paddingTop: 0 }}>
        <span className="g-hint">Legacy план</span>
        <StatusBadge status={badge.status} label={badge.label} pulse={badge.pulse} />
      </div>
      <div className="g-row">
        <span>Сумма</span>
        <strong>{plan.usdt_amount ?? 0} USDT</strong>
      </div>
      <div className="g-row">
        <span>Частота</span>
        <span>{freq}</span>
      </div>
      <div className="g-row">
        <span>Режим</span>
        <span>{strategyModeLabel(plan.strategy_mode)}</span>
      </div>
      <div className="g-row">
        <span>Следующий цикл</span>
        <span>{formatRelativeTime(plan.next_execution_at)}</span>
      </div>
      <div className="g-row">
        <span>Циклов</span>
        <span>{plan.cycles_completed ?? 0}</span>
      </div>
      <div className="g-row">
        <span>Вывод</span>
        <span>
          {plan.withdrawal_address_set && plan.ton_address ? (
            <LockedAddress address={plan.ton_address} />
          ) : (
            <span style={{ color: "var(--g-warn-text)" }}>Укажите адрес</span>
          )}
        </span>
      </div>
    </div>
  );
}

function MultiStrategyRow({ s, isFirst }: { s: StrategyInfo; isFirst?: boolean }) {
  const badge = strategyRowStatus(s);
  const freq = FREQUENCY_LABELS[s.frequency] ?? s.frequency;

  return (
    <div
      style={
        isFirst
          ? undefined
          : { paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--g-border)" }
      }
    >
      <div className="g-row" style={{ borderTop: "none", paddingTop: 0 }}>
        <strong>
          #{s.id} {STRATEGY_TYPE_LABELS[s.strategy_type]}
        </strong>
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
      <div className="g-row">
        <span>Сумма</span>
        <span>{s.amount_usdt} USDT</span>
      </div>
      <div className="g-row">
        <span>Частота</span>
        <span>{freq}</span>
      </div>
      {s.strategy_type === "dca_lp" && (
        <div className="g-row">
          <span>LP</span>
          <span>{s.output_mode === "reinvest" ? "Reinvest" : "Withdraw"}</span>
        </div>
      )}
      <div className="g-row">
        <span>Следующий запуск</span>
        <span>{formatRelativeTime(s.next_run_at ?? undefined)}</span>
      </div>
      <div className="g-row">
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
      <section className="g-card g-section">
        <div className="g-section-label">Стратегии</div>
        <p className="g-hint">План не найден. Создайте через onboarding или /add в боте.</p>
      </section>
    );
  }

  return (
    <section className="g-card g-section">
      <div className="g-section-label">Стратегии</div>
      {strategies.length > 0
        ? strategies.map((s, i) => <MultiStrategyRow key={s.id} s={s} isFirst={i === 0} />)
        : plan && <LegacyPlanCard plan={plan} />}
    </section>
  );
}
