import { Skeleton } from "../../components/Skeleton";
import type { PortfolioResponse } from "../../api/portfolio";
import { S } from "../../styles";

function PortfolioSkeleton() {
  return (
    <div style={S.card}>
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="55%" height={32} style={{ marginBottom: 12 }} />
      <Skeleton width="75%" height={14} />
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
    <div style={S.card}>
      <div style={{ ...S.value, marginBottom: 8 }}>${estValue.toFixed(2)}</div>
      <div
        style={{
          fontSize: 14,
          color: "var(--tg-theme-hint-color, #888)",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span>USDT ${usdt.toFixed(2)}</span>
        <span>·</span>
        <span>TON {ton.toFixed(3)}</span>
        <span>·</span>
        <span>LP {lp != null ? `$${lp.toFixed(2)}` : "—"}</span>
      </div>
    </div>
  );
}
