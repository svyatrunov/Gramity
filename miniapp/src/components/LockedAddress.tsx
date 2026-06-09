import { maskAddress } from "../config";

export function LockedAddress({ address }: { address: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <span aria-hidden>🔒</span>
      {maskAddress(address)}
    </span>
  );
}
