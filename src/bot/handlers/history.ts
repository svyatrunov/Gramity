import type { GramityContext } from "../session.js";
import { pool } from "../../db/index.js";

export async function handleHistory(ctx: GramityContext) {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const result = await pool.query(
    `SELECT e.id, e.executed_at AS created_at, e.usdt_spent AS amount_usdt,
            e.status, e.lp_tokens_added AS lp_tokens_received
     FROM executions e
     JOIN plans p ON e.plan_id = p.id
     WHERE p.telegram_id = $1
     ORDER BY e.executed_at DESC
     LIMIT 5`,
    [telegramId]
  );

  if (result.rows.length === 0) {
    await ctx.reply("No history yet. The first cycle hasn't run yet.");
    return;
  }

  const lines = result.rows.map((row, i) => {
    const date = new Date(row.created_at).toLocaleDateString("en-US", {
      day:    "2-digit",
      month:  "short",
      hour:   "2-digit",
      minute: "2-digit",
    });
    const lp     = row.lp_tokens_received
      ? `→ ${parseFloat(row.lp_tokens_received).toFixed(2)} LP`
      : "";
    const status = row.status === "success" ? "✅" : row.status === "pending" ? "⏳" : "❌";
    return `${i + 1}. ${status} ${date} — $${row.amount_usdt} ${lp}`;
  });

  const text =
    `📋 *Last cycle history*\n\n${lines.join("\n")}\n\n` +
    `_Each cycle: USDT → TON → staking → liquidity_`;

  await ctx.reply(text, { parse_mode: "Markdown" });
}
