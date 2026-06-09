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
        borderRadius: 6,
        background:
          "linear-gradient(90deg, var(--tg-theme-secondary-bg-color, #eee) 25%, var(--tg-theme-bg-color, #fff) 50%, var(--tg-theme-secondary-bg-color, #eee) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.2s infinite",
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      style={{
        background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
      }}
    >
      <Skeleton width="40%" height={12} style={{ marginBottom: 12 }} />
      <Skeleton width="60%" height={28} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={14} />
    </div>
  );
}
