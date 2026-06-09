import { pool } from "../db/index.js";

export const WITHDRAWAL_CHAINS = {
  ton:     { label: "TON",       token: "USD₮",  symbol: "usdt", address_type: "ton" as const },
  eth:     { label: "Ethereum",  token: "USD₮",  symbol: "usdt", address_type: "evm" as const },
  bnb:     { label: "BNB Chain", token: "USD₮",  symbol: "usdt", address_type: "evm" as const },
  base:    { label: "Base",      token: "USDC",  symbol: "usdc", address_type: "evm" as const },
  polygon: { label: "Polygon",   token: "pUSD",  symbol: "pusd", address_type: "evm" as const },
} as const;

export type WithdrawalChain = keyof typeof WITHDRAWAL_CHAINS;

export async function validateAndCheckAddress(
  address: string,
  chain: WithdrawalChain
): Promise<{ valid: boolean; warning?: string; error?: string }> {
  const { address_type } = WITHDRAWAL_CHAINS[chain];

  if (address_type === "ton") {
    if (!/^(EQ|UQ)[A-Za-z0-9_-]{46}$/.test(address)) {
      return {
        valid: false,
        error: "Invalid TON address. Expected EQ... or UQ... (48 chars)",
      };
    }
    try {
      const res = await fetch(
        `https://tonapi.io/v2/accounts/${encodeURIComponent(address)}`,
        { signal: AbortSignal.timeout(4000) }
      );
      const data = (await res.json()) as { status?: string };
      if (data.status === "nonexist") {
        return { valid: false, error: "Address not found on TON. Check for typos." };
      }
      if (data.status === "uninit") {
        return {
          valid: true,
          warning: "Address has no transaction history. Make sure it belongs to you.",
        };
      }
      return { valid: true };
    } catch {
      return { valid: true };
    }
  }

  if (address_type === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return {
        valid: false,
        error: "Invalid EVM address. Expected 0x... (42 chars, hex)",
      };
    }
    return { valid: true };
  }

  return { valid: false, error: "Unknown chain" };
}

export async function saveWithdrawalAddress(
  telegramId: string | number,
  address: string,
  chain: WithdrawalChain
): Promise<boolean> {
  const { symbol } = WITHDRAWAL_CHAINS[chain];
  const result = await pool.query(
    `UPDATE plans
     SET ton_address             = $1,
         withdrawal_chain        = $2,
         withdrawal_token        = $3,
         withdrawal_address_set  = true
     WHERE telegram_id = $4
       AND (withdrawal_address_set = false OR withdrawal_address_set IS NULL)
     RETURNING id`,
    [address, chain, symbol, telegramId]
  );
  return (result.rowCount ?? 0) > 0;
}

export function isWithdrawalAddressSet(plan: {
  withdrawal_address_set?: boolean | null;
  ton_address?: string | null;
}): boolean {
  if (plan.withdrawal_address_set === true) return true;
  const addr = plan.ton_address;
  return typeof addr === "string" && addr.trim().length > 0;
}
