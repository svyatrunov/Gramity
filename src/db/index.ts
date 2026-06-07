import { Pool } from "pg";

// Lazy singleton — Pool is created on first use, after dotenv.config() has run
let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing env var: DATABASE_URL");
  _pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return _pool;
}

/** Lazy pool proxy for services that need `pool.query(sql, params)` */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pool = { query: (sql: string, params?: any[]) => getPool().query(sql, params) };

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_wallets (
  telegram_id        BIGINT      PRIMARY KEY,
  wallet_address     TEXT        NOT NULL,
  encrypted_mnemonic TEXT        NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_id       BIGINT      NOT NULL UNIQUE,
  ton_address       TEXT        NOT NULL,
  agent_wallet      TEXT,
  usdt_amount       NUMERIC     NOT NULL,
  frequency         TEXT        NOT NULL,
  active            BOOLEAN     DEFAULT true,
  next_execution_at TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS executions (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id           UUID        REFERENCES plans(id),
  executed_at       TIMESTAMPTZ DEFAULT now(),
  usdt_spent        NUMERIC,
  ton_received      NUMERIC,
  tston_received    NUMERIC,
  lp_tokens_added   NUMERIC,
  ton_price_usdt    NUMERIC,
  lp_position_value NUMERIC,
  tx_swap           TEXT,
  tx_stake          TEXT,
  tx_lp             TEXT,
  status            TEXT        DEFAULT 'success'
);

-- Idempotent migrations
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN strategy_mode TEXT NOT NULL DEFAULT 'full';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Multi-wallet migration (idempotent)
DO $$ BEGIN
  ALTER TABLE user_wallets ADD COLUMN id UUID DEFAULT gen_random_uuid();
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_wallets ADD COLUMN alias TEXT NOT NULL DEFAULT 'Main';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN wallet_id UUID;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS user_wallets_telegram_id_idx ON user_wallets(telegram_id);
`;

export async function initDb(): Promise<void> {
  await getPool().query(SCHEMA_SQL);
  console.log("[DB] Schema ready");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  telegram_id: number;
  ton_address: string;
  agent_wallet: string | null;
  usdt_amount: number;
  frequency: "weekly" | "biweekly" | "monthly" | "minutely" | "hourly";
  strategy_mode: "full" | "stake_only" | "accumulate";
  active: boolean;
  next_execution_at: string;
  created_at: string;
}

export interface Execution {
  id: string;
  plan_id: string;
  executed_at: string;
  usdt_spent: number | null;
  ton_received: number | null;
  tston_received: number | null;
  lp_tokens_added: number | null;
  ton_price_usdt: number | null;
  lp_position_value: number | null;
  tx_swap: string | null;
  tx_stake: string | null;
  tx_lp: string | null;
  status: "success" | "failed" | "partial";
}

// ─── Plan queries ─────────────────────────────────────────────────────────────

export async function getPlanByTelegramId(
  telegramId: number
): Promise<Plan | null> {
  const { rows } = await getPool().query<Plan>(
    "SELECT * FROM plans WHERE telegram_id = $1 LIMIT 1",
    [telegramId]
  );
  return rows[0] ?? null;
}

export async function upsertPlan(
  plan: Omit<Plan, "id" | "created_at">
): Promise<Plan> {
  const { rows } = await getPool().query<Plan>(
    `INSERT INTO plans
       (telegram_id, ton_address, agent_wallet, usdt_amount, frequency, active, next_execution_at, strategy_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (telegram_id) DO UPDATE SET
       ton_address       = EXCLUDED.ton_address,
       agent_wallet      = EXCLUDED.agent_wallet,
       usdt_amount       = EXCLUDED.usdt_amount,
       frequency         = EXCLUDED.frequency,
       active            = EXCLUDED.active,
       next_execution_at = EXCLUDED.next_execution_at,
       strategy_mode     = EXCLUDED.strategy_mode
     RETURNING *`,
    [
      plan.telegram_id,
      plan.ton_address,
      plan.agent_wallet,
      plan.usdt_amount,
      plan.frequency,
      plan.active,
      plan.next_execution_at,
      plan.strategy_mode,
    ]
  );
  return rows[0];
}

export async function updatePlan(
  telegramId: number,
  updates: Partial<Pick<Plan, "active" | "next_execution_at" | "usdt_amount" | "frequency" | "strategy_mode" | "ton_address">>
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = $${i++}`);
    values.push(val);
  }
  if (fields.length === 0) return;

  values.push(telegramId);
  await getPool().query(
    `UPDATE plans SET ${fields.join(", ")} WHERE telegram_id = $${i}`,
    values
  );
}

export async function getDuePlans(): Promise<Plan[]> {
  const { rows } = await getPool().query<Plan>(
    "SELECT * FROM plans WHERE active = true AND next_execution_at <= NOW()"
  );
  return rows;
}

// ─── Execution queries ────────────────────────────────────────────────────────

export async function logExecution(
  execution: Omit<Execution, "id" | "executed_at">
): Promise<void> {
  await getPool().query(
    `INSERT INTO executions
       (plan_id, usdt_spent, ton_received, tston_received, lp_tokens_added,
        ton_price_usdt, lp_position_value, tx_swap, tx_stake, tx_lp, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      execution.plan_id,
      execution.usdt_spent,
      execution.ton_received,
      execution.tston_received,
      execution.lp_tokens_added,
      execution.ton_price_usdt,
      execution.lp_position_value,
      execution.tx_swap,
      execution.tx_stake,
      execution.tx_lp,
      execution.status,
    ]
  );
}

export async function getLastExecutions(
  planId: string,
  limit = 5
): Promise<Execution[]> {
  const { rows } = await getPool().query<Execution>(
    "SELECT * FROM executions WHERE plan_id = $1 ORDER BY executed_at DESC LIMIT $2",
    [planId, limit]
  );
  return rows;
}

export async function deletePlan(telegramId: number): Promise<void> {
  await getPool().query("DELETE FROM plans WHERE telegram_id = $1", [telegramId]);
}

export async function getTotalInvested(planId: string): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    "SELECT COALESCE(SUM(usdt_spent), 0) AS total FROM executions WHERE plan_id = $1 AND status = 'success'",
    [planId]
  );
  return Number(rows[0]?.total ?? 0);
}

// ─── Multi-wallet queries ──────────────────────────────────────────────────────

export interface UserWalletRecord {
  telegram_id: number;
  wallet_address: string;
  encrypted_mnemonic: string;
  alias: string;
  created_at: string;
}

export async function getUserWallets(
  telegramId: number
): Promise<UserWalletRecord[]> {
  const { rows } = await getPool().query<UserWalletRecord>(
    "SELECT * FROM user_wallets WHERE telegram_id = $1 ORDER BY created_at ASC",
    [telegramId]
  );
  return rows;
}

export async function renameUserWallet(
  telegramId: number,
  walletAddress: string,
  alias: string
): Promise<void> {
  await getPool().query(
    "UPDATE user_wallets SET alias = $1 WHERE telegram_id = $2 AND wallet_address = $3",
    [alias, telegramId, walletAddress]
  );
}
