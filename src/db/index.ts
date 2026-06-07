import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "../config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Plan {
  id: string;
  telegram_id: number;
  ton_address: string;
  agent_wallet: string | null;
  usdt_amount: number;
  frequency: "weekly" | "biweekly" | "monthly";
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
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return data ?? null;
}

export async function upsertPlan(
  plan: Omit<Plan, "id" | "created_at">
): Promise<Plan> {
  const { data, error } = await supabase
    .from("plans")
    .upsert(plan, { onConflict: "telegram_id" })
    .select()
    .single();
  if (error) throw new Error(`upsertPlan: ${error.message}`);
  return data as Plan;
}

export async function updatePlan(
  telegramId: number,
  updates: Partial<Plan>
): Promise<void> {
  const { error } = await supabase
    .from("plans")
    .update(updates)
    .eq("telegram_id", telegramId);
  if (error) throw new Error(`updatePlan: ${error.message}`);
}

export async function getDuePlans(): Promise<Plan[]> {
  const { data } = await supabase
    .from("plans")
    .select("*")
    .eq("active", true)
    .lte("next_execution_at", new Date().toISOString());
  return data ?? [];
}

// ─── Execution queries ────────────────────────────────────────────────────────

export async function logExecution(
  execution: Omit<Execution, "id" | "executed_at">
): Promise<void> {
  const { error } = await supabase.from("executions").insert(execution);
  if (error) throw new Error(`logExecution: ${error.message}`);
}

export async function getLastExecutions(
  planId: string,
  limit = 5
): Promise<Execution[]> {
  const { data } = await supabase
    .from("executions")
    .select("*")
    .eq("plan_id", planId)
    .order("executed_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getTotalInvested(planId: string): Promise<number> {
  const { data } = await supabase
    .from("executions")
    .select("usdt_spent")
    .eq("plan_id", planId)
    .eq("status", "success");

  if (!data) return 0;
  return data.reduce((sum, e) => sum + (e.usdt_spent ?? 0), 0);
}
