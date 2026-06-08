import { Address } from "@ton/ton";

/** Normalize user input to bounceable url-safe TON address, or null if invalid. */
export function normalizeTonAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const addr = Address.parse(trimmed);
    return addr.toString({ urlSafe: true, bounceable: true });
  } catch {
    return null;
  }
}

export function hasWithdrawalAddress(
  address: string | null | undefined
): address is string {
  return typeof address === "string" && address.trim().length > 0;
}
