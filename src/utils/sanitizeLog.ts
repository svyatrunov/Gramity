const REDACTED = [
  "encrypted_mnemonic",
  "mnemonic",
  "private_key",
  "seed_phrase",
  "wallet_id",
  "ton_address",
] as const;

export function sanitizeLog(
  obj: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      (REDACTED as readonly string[]).includes(k) ? [k, "[REDACTED]"] : [k, v]
    )
  );
}
