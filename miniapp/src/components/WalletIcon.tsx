import type { SimpleIcon } from "simple-icons";

interface WalletIconProps {
  icon: SimpleIcon | CustomWalletIcon;
  size?: number;
  color?: string;
}

export interface CustomWalletIcon {
  path: string;
  hex: string;
  title: string;
  viewBox?: string;
}

/** MetaMask fox — официальный упрощённый путь (#F6851B) */
export const metamaskIcon: CustomWalletIcon = {
  title: "MetaMask",
  hex: "F6851B",
  // Simplified fox silhouette derived from MetaMask open-source assets
  path: "M21.315 2L13.294 8.018l1.522-3.601L21.315 2zM2.685 2l7.955 6.06-1.449-3.643L2.685 2zM18.507 15.71l-2.134 3.267 4.566 1.257 1.312-4.457-3.744-.067zM5.753 15.777l1.302 4.457 4.556-1.257-2.124-3.267-3.734.067zM11.34 10.21L9.925 12.45l4.523.206-.16-4.862-2.948 2.415zM12.65 10.21l2.98 2.448-.19-4.874-2.79 2.426z",
  viewBox: "0 0 24 24",
};

export function WalletIcon({ icon, size = 24, color }: WalletIconProps) {
  const fill = color ?? `#${icon.hex}`;
  const viewBox = (icon as CustomWalletIcon).viewBox ?? "0 0 24 24";

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      aria-label={(icon as CustomWalletIcon).title ?? (icon as SimpleIcon).title}
      role="img"
    >
      <path d={icon.path} />
    </svg>
  );
}
