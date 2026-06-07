import * as dotenv from "dotenv";
dotenv.config();

function require_env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

// ─── Master encryption key (per-user wallet encryption) ──────────────────────
if (
  !process.env.MASTER_ENCRYPTION_KEY ||
  process.env.MASTER_ENCRYPTION_KEY.length !== 64
) {
  throw new Error("MASTER_ENCRYPTION_KEY must be 32 bytes hex (64 hex chars)");
}

// ─── Wallet ───────────────────────────────────────────────────────────────────
// Lazy — only validated when execution engine actually runs
export function getMnemonic(): string[] {
  return require_env("BACKEND_WALLET_MNEMONIC").split(" ");
}
/** @deprecated use getMnemonic() — kept for CLI scripts */
export const MNEMONIC = process.env.BACKEND_WALLET_MNEMONIC?.split(" ") ?? [];
export const TONCENTER_API_KEY = process.env.TONCENTER_API_KEY ?? "";
export const REFERRER_WALLET = process.env.REFERRER_WALLET ?? "";

// ─── Omniston ─────────────────────────────────────────────────────────────────
export const OMNISTON_WS_URL =
  process.env.OMNISTON_WS_URL ?? "wss://omni-ws.ston.fi";

// ─── STON.fi ──────────────────────────────────────────────────────────────────
export const STON_API_URL =
  process.env.STON_API_URL ?? "https://api.ston.fi";

// ─── TON API ──────────────────────────────────────────────────────────────────
export const TON_API_URL =
  process.env.TON_API_URL ?? "https://tonapi.io/v2";

// ─── TonCenter mainnet ────────────────────────────────────────────────────────
export const TONCENTER_URL =
  process.env.TONCENTER_URL ?? "https://toncenter.com/api/v2/jsonRPC";

// ─── Addresses (mainnet) ──────────────────────────────────────────────────────
export const USDT_ADDRESS =
  process.env.USDT_ADDRESS ??
  "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";

// tsTON jetton master — mainnet
export const TSTON_ADDRESS =
  process.env.TSTON_ADDRESS ??
  "EQC98_qAmNEptUtPc7W6xdHh_ZHrBUFpw5Ft_IzNU20QAJav";

// tsTON/TON pool address — mainnet
export const POOL_ADDRESS =
  process.env.POOL_ADDRESS ??
  "EQBjiBVhFLQVCMS8mKMA3gS823m9Xeu9aXiZUYD4TP8GDvui";

// Tonstakers mainnet staking contract
export const TONSTAKERS_CONTRACT =
  process.env.TONSTAKERS_CONTRACT ??
  "EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGxnfBskEunu";

// ─── Fee ──────────────────────────────────────────────────────────────────────
// 10 bps = 0.1%; in Omniston v1beta8 pips: 1 pip = 0.0001%, so 10 bps = 1000 pips
export const INTEGRATOR_FEE_PIPS = 1000;

// ─── DCA input ────────────────────────────────────────────────────────────────
export const INPUT_USDT = Number(process.env.INPUT_USDT ?? "5");
export const USDT_DECIMALS = 6;

// ─── Bot ──────────────────────────────────────────────────────────────────────
export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";

// ─── Server ───────────────────────────────────────────────────────────────────
export const PORT = process.env.PORT ?? "3000";

// ─── Public URL ───────────────────────────────────────────────────────────────
export const RAILWAY_PUBLIC_URL =
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.APP_URL ?? "https://gramity-production.up.railway.app";
