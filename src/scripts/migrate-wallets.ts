/**
 * One-time migration: register existing BACKEND_WALLET_MNEMONIC
 * as the personal wallet for all users who don't have one yet.
 *
 * Run ONCE after first deploy:
 *   npm run migrate
 *
 * Prerequisites (Railway Variables):
 *   MASTER_ENCRYPTION_KEY  — 32-byte hex (already set)
 *   BACKEND_WALLET_MNEMONIC — existing hot wallet mnemonic
 *   BACKEND_WALLET_ADDRESS  — EQBpHXcaZUg4XqlCt3cCEoOZaQo2DyAT10U8NQUyCzdI385F
 */

import * as dotenv from "dotenv";
dotenv.config();

import { pool, initDb } from "../db/index.js";
import { encrypt } from "../services/userWallet.js";

async function migrate() {
  await initDb();

  const mnemonic = process.env.BACKEND_WALLET_MNEMONIC;
  const address = process.env.BACKEND_WALLET_ADDRESS;

  if (!mnemonic) {
    console.error("ERROR: BACKEND_WALLET_MNEMONIC is not set");
    process.exit(1);
  }
  if (!address) {
    console.error("ERROR: BACKEND_WALLET_ADDRESS is not set");
    process.exit(1);
  }

  // Find all users without a wallet record
  const plans = await pool.query(`
    SELECT p.telegram_id
    FROM plans p
    LEFT JOIN user_wallets w ON w.telegram_id = p.telegram_id
    WHERE w.telegram_id IS NULL
  `);

  console.log(`Found ${plans.rows.length} user(s) to migrate`);

  const encrypted = encrypt(mnemonic);

  for (const row of plans.rows as { telegram_id: number }[]) {
    await pool.query(
      `INSERT INTO user_wallets (telegram_id, wallet_address, encrypted_mnemonic)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO NOTHING`,
      [row.telegram_id, address, encrypted]
    );
    console.log(`  ✓ Migrated user ${row.telegram_id} → ${address}`);
  }

  console.log("Migration complete.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
