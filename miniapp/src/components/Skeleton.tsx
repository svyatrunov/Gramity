import React from "react";

export function Skeleton({
  width = "100%",
  height = 16,
  style,
}: {
  width?: string | number;
  height?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background:
          "linear-gradient(90deg, var(--g-surface) 25%, var(--g-surface-elevated) 50%, var(--g-surface) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.2s infinite",
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="g-card">
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="60%" height={28} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} />
    </div>
  );
}
