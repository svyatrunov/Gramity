import { getPool } from "../db/index.js";
import {
  signContextToken,
  verifyContextToken,
  newContextJti,
  buildMiraDeeplink,
} from "./utils.js";

export async function createContextHandoff(telegramId: number): Promise<{
  token: string;
  mira_deeplink: string;
}> {
  const jti = newContextJti();
  await getPool().query(
    `INSERT INTO mira_context_tokens (jti, telegram_id) VALUES ($1, $2)`,
    [jti, telegramId]
  );
  const token = signContextToken(telegramId, jti);
  return {
    token,
    mira_deeplink: buildMiraDeeplink(token),
  };
}

/** Returns telegram_id if token is valid and not yet consumed; marks as consumed. */
export async function consumeContextToken(
  token: string
): Promise<{ telegramId: number } | null> {
  const parsed = verifyContextToken(token);
  if (!parsed) return null;

  const { rows } = await getPool().query<{ consumed_at: string | null }>(
    `UPDATE mira_context_tokens
     SET consumed_at = now()
     WHERE jti = $1 AND consumed_at IS NULL
     RETURNING consumed_at`,
    [parsed.jti]
  );

  if (rows.length === 0) return null;
  return { telegramId: parsed.telegramId };
}

export async function isContextTokenConsumed(token: string): Promise<boolean> {
  const parsed = verifyContextToken(token);
  if (!parsed) return true;
  const { rows } = await getPool().query<{ consumed_at: string | null }>(
    `SELECT consumed_at FROM mira_context_tokens WHERE jti = $1`,
    [parsed.jti]
  );
  return !rows[0] || rows[0].consumed_at !== null;
}
