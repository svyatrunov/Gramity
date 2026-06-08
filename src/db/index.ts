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

-- Demo mode migration (idempotent)
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN demo_mode BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN cycles_completed INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN max_cycles INT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

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

-- Failure tracking & error logging (idempotent)
DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE plans ADD COLUMN last_error TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_log (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id      UUID        REFERENCES plans(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT now(),
  success      BOOLEAN     NOT NULL DEFAULT true,
  telegram_msg TEXT,
  error        TEXT
);
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
  frequency: "weekly" | "biweekly" | "monthly" | "daily" | "minutely" | "hourly" | "demo";
  strategy_mode: "full" | "stake_only" | "accumulate";
  active: boolean;
  next_execution_at: string;
  created_at: string;
  demo_mode: boolean;
  cycles_completed: number;
  max_cycles: number | null;
  consecutive_failures: number;
  last_error: string | null;
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
  plan: Omit<Plan, "id" | "created_at" | "consecutive_failures" | "last_error">
): Promise<Plan> {
  const { rows } = await getPool().query<Plan>(
    `INSERT INTO plans
       (telegram_id, ton_address, agent_wallet, usdt_amount, frequency, active, next_execution_at, strategy_mode, demo_mode, cycles_completed, max_cycles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (telegram_id) DO UPDATE SET
       ton_address       = EXCLUDED.ton_address,
       agent_wallet      = EXCLUDED.agent_wallet,
       usdt_amount       = EXCLUDED.usdt_amount,
       frequency         = EXCLUDED.frequency,
       active            = EXCLUDED.active,
       next_execution_at = EXCLUDED.next_execution_at,
       strategy_mode     = EXCLUDED.strategy_mode,
       demo_mode         = EXCLUDED.demo_mode,
       cycles_completed  = EXCLUDED.cycles_completed,
       max_cycles        = EXCLUDED.max_cycles
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
      plan.demo_mode ?? false,
      plan.cycles_completed ?? 0,
      plan.max_cycles ?? null,
    ]
  );
  return rows[0];
}

export async function incrementCyclesCompleted(planId: string): Promise<number> {
  const { rows } = await getPool().query<{ cycles_completed: number }>(
    `UPDATE plans SET cycles_completed = cycles_completed + 1 WHERE id = $1 RETURNING cycles_completed`,
    [planId]
  );
  return rows[0]?.cycles_completed ?? 0;
}

export async function updatePlan(
  telegramId: number,
  updates: Partial<Pick<Plan, "active" | "next_execution_at" | "usdt_amount" | "frequency" | "strategy_mode" | "ton_address" | "demo_mode" | "cycles_completed" | "max_cycles" | "consecutive_failures" | "last_error">>
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
  const pool = getPool();
  await pool.query(
    "DELETE FROM executions WHERE plan_id IN (SELECT id FROM plans WHERE telegram_id = $1)",
    [telegramId]
  );
  await pool.query("DELETE FROM plans WHERE telegram_id = $1", [telegramId]);
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

// ─── Failure tracking ──────────────────────────────────────────────────────────

/** Increments consecutive_failures by 1. Returns the new count. */
export async function incrementConsecutiveFailures(planId: string): Promise<number> {
  const { rows } = await getPool().query<{ consecutive_failures: number }>(
    `UPDATE plans
     SET consecutive_failures = consecutive_failures + 1
     WHERE id = $1
     RETURNING consecutive_failures`,
    [planId]
  );
  return rows[0]?.consecutive_failures ?? 1;
}

/** Resets consecutive_failures to 0 and clears last_error on successful cycle. */
export async function resetConsecutiveFailures(planId: string): Promise<void> {
  await getPool().query(
    `UPDATE plans SET consecutive_failures = 0, last_error = NULL WHERE id = $1`,
    [planId]
  );
}

/** Stores the last error message for a plan (used by execution engine on timeout/failure). */
export async function setPlanLastError(planId: string, lastError: string): Promise<void> {
  await getPool().query(
    `UPDATE plans SET last_error = $2 WHERE id = $1`,
    [planId, lastError.slice(0, 500)]
  );
}

// ─── Notification log ─────────────────────────────────────────────────────────

/**
 * Logs every bot notification attempt.
 * Failures are logged too (success = false, error = reason).
 * Never throws — logging must never break the execution path.
 */
export async function logNotification(
  planId: string,
  type: string,
  success: boolean,
  telegramMsg?: string,
  error?: string
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO notification_log (plan_id, type, success, telegram_msg, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [planId, type, success, telegramMsg?.slice(0, 2000) ?? null, error?.slice(0, 500) ?? null]
    );
  } catch (err) {
    console.error("[DB] Failed to log notification:", err);
  }
}
