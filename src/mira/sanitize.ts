const SENSITIVE_PATTERN =
  /mnemonic|private_key|encrypted_mnemonic|wallet_id|seed_phrase/i;

export function maskAddress(address: string | null | undefined): string {
  if (!address || address.length < 10) return "not set";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/** Strip sensitive fields before any Mira-facing response. */
export function sanitizeForMira<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForMira(item)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PATTERN.test(key)) continue;
    out[key] = sanitizeForMira(val);
  }
  return out as T;
}
