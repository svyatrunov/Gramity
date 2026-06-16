import { Skeleton } from "../../components/Skeleton";
import type { PortfolioResponse } from "../../api/portfolio";

function PortfolioSkeleton() {
  return (
    <div className="g-card">
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="55%" height={32} style={{ marginBottom: 12 }} />
      <div className="g-stat-grid">
        <Skeleton height={36} />
        <Skeleton height={36} />
        <Skeleton height={36} />
      </div>
    </div>
  );
}

export function PortfolioBlock({
  data,
  loading,
}: {
  data: PortfolioResponse | null;
  loading: boolean;
}) {
  if (loading && !data) {
    return <PortfolioSkeleton />;
  }

  const estValue = data?.est_value_usd ?? data?.totalValue ?? 0;
  const usdt = data?.usdtBalance ?? 0;
  const ton = data?.tonBalance ?? 0;
  const lp = data?.lpValue;

  return (
    <section className="g-card g-section" aria-label="Портфель">
      <div className="g-section-label">Оценка портфеля</div>
      <div className="g-hero-metric">${estValue.toFixed(2)}</div>
      <div className="g-stat-grid">
        <div className="g-stat-item">
          <span className="g-stat-label">USDT</span>
          <span className="g-stat-value">${usdt.toFixed(2)}</span>
        </div>
        <div className="g-stat-item">
          <span className="g-stat-label">TON</span>
          <span className="g-stat-value">{ton.toFixed(3)}</span>
        </div>
        <div className="g-stat-item">
          <span className="g-stat-label">LP</span>
          <span className="g-stat-value">{lp != null ? `$${lp.toFixed(2)}` : "—"}</span>
        </div>
      </div>
    </section>
  );
}
