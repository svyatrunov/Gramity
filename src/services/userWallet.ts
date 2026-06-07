import { mnemonicNew, mnemonicToWalletKey } from "@ton/crypto";
import { WalletContractV4, TonClient } from "@ton/ton";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { pool } from "../db/index.js";
import { TONCENTER_URL, TONCENTER_API_KEY } from "../config.js";
import type { WalletContext } from "../wallet.js";

const MASTER_KEY = Buffer.from(process.env.MASTER_ENCRYPTION_KEY!, "hex"); // 32 bytes

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

function decrypt(data: string): string {
  const [ivHex, authTagHex, encryptedHex] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", MASTER_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Returns existing wallet address or creates a new one for the user.
 * Safe to call multiple times — idempotent.
 */
export async function createUserWallet(telegramId: number): Promise<string> {
  const existing = await pool.query(
    "SELECT wallet_address FROM user_wallets WHERE telegram_id = $1",
    [telegramId]
  );
  if (existing.rows[0]) return existing.rows[0].wallet_address as string;

  const mnemonic = await mnemonicNew(24);
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
  const address = wallet.address.toString({ urlSafe: true, bounceable: false }); // UQ — for deposits

  const encrypted = encrypt(mnemonic.join(" "));
  await pool.query(
    `INSERT INTO user_wallets (telegram_id, wallet_address, encrypted_mnemonic)
     VALUES ($1, $2, $3)`,
    [telegramId, address, encrypted]
  );

  console.log(`[WALLET] Created wallet for user ${telegramId}: ${address}`);
  return address;
}

/**
 * Reconstructs the full WalletContext for signing transactions.
 * Throws if no wallet exists — call createUserWallet first.
 */
export async function getUserWalletContext(telegramId: number): Promise<WalletContext> {
  const row = await pool.query(
    "SELECT encrypted_mnemonic FROM user_wallets WHERE telegram_id = $1",
    [telegramId]
  );
  if (!row.rows[0]) throw new Error(`No wallet for user ${telegramId}`);

  const mnemonic = decrypt(row.rows[0].encrypted_mnemonic as string).split(" ");
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });

  const client = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  const contract = client.open(wallet);
  const address = wallet.address.toString({ urlSafe: true, bounceable: true }); // EQ — for on-chain ops

  return { key, wallet, client, contract, address };
}

/**
 * Create a new named wallet for the user (multi-wallet support).
 * Unlike createUserWallet, this always creates a fresh wallet even if one exists.
 */
export async function createNamedWallet(
  telegramId: number,
  alias: string
): Promise<string> {
  const mnemonic = await mnemonicNew(24);
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
  const address = wallet.address.toString({ urlSafe: true, bounceable: false });

  const encrypted = encrypt(mnemonic.join(" "));
  await pool.query(
    `INSERT INTO user_wallets (telegram_id, wallet_address, encrypted_mnemonic, alias)
     VALUES ($1, $2, $3, $4)`,
    [telegramId, address, encrypted, alias]
  );

  console.log(`[WALLET] Created named wallet "${alias}" for user ${telegramId}: ${address}`);
  return address;
}

/**
 * Get WalletContext for a specific wallet address (not just the primary one).
 */
export async function getWalletContextByAddress(
  telegramId: number,
  walletAddress: string
): Promise<import("../wallet.js").WalletContext> {
  const row = await pool.query(
    "SELECT encrypted_mnemonic FROM user_wallets WHERE telegram_id = $1 AND wallet_address = $2",
    [telegramId, walletAddress]
  );
  if (!row.rows[0]) throw new Error(`Wallet ${walletAddress} not found for user ${telegramId}`);

  const mnemonic = decrypt(row.rows[0].encrypted_mnemonic as string).split(" ");
  const key = await mnemonicToWalletKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });

  const client = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  const contract = client.open(wallet);
  const address = wallet.address.toString({ urlSafe: true, bounceable: true });

  return { key, wallet, client, contract, address };
}
