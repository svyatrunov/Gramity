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

/** Ankr Advanced API — free tier at https://www.ankr.com/rpc/advanced-api */
export const ANKR_API_KEY = process.env.ANKR_API_KEY ?? "";

/** BSC JSON-RPC fallback when Ankr is unavailable */
export const BSC_RPC_URL =
  process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org";

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

/** Packaged DCA products (wallet strategies). */
export const STRATEGY_PRODUCTS = [
  {
    id: "buy_ton",
    strategy_type: "dca_ton" as const,
    label: "Buy TON",
    description: "USDT → TON every cycle",
    needs_token_picker: false,
  },
  {
    id: "other_tokens",
    strategy_type: "dca_jetton" as const,
    label: "Other tokens",
    description: "USDT → any jetton via Omniston",
    needs_token_picker: true,
    jetton_only: true,
  },
  {
    id: "stake_tston",
    strategy_type: "dca_tston" as const,
    label: "Stake tsTON",
    description: "USDT → tsTON liquid staking",
    needs_token_picker: false,
  },
  {
    id: "lp_dca",
    strategy_type: "dca_lp" as const,
    label: "LP position",
    description: "tsTON → STON.fi LP (~5.4% APY)",
    needs_token_picker: false,
  },
] as const;

/** Popular swap targets for the token picker (jetton master addresses). */
export const POPULAR_SWAP_TOKENS = [
  { symbol: "TON", address: null as string | null, native: true },
  {
    symbol: "NOT",
    address: "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT",
    native: false,
  },
  {
    symbol: "STON",
    address: "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmn32ehfw",
    native: false,
  },
  {
    symbol: "DOGS",
    address: "EQCvxJy4eG8hyHBFsZ7eePxrRgKuFRwi2wqiaoyJtDwLUJP",
    native: false,
  },
  {
    symbol: "USDC",
    address: "EQBynBO23ywHy_CgarY9NK9FTz0yDsGAsQjeqGTwGMyWi7u",
    native: false,
  },
] as const;

// ─── Bot ──────────────────────────────────────────────────────────────────────
export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";

/** TON hot wallet — cross-chain deposit destination */
export const BOT_WALLET_ADDRESS = process.env.BOT_WALLET_ADDRESS ?? "";

// ─── Server ───────────────────────────────────────────────────────────────────
export const PORT = process.env.PORT ?? "3000";

// ─── Public URL ───────────────────────────────────────────────────────────────
export const RAILWAY_PUBLIC_URL =
  process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : process.env.APP_URL ?? "https://gramity-production.up.railway.app";

// ─── Environment guards ───────────────────────────────────────────────────────
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const IS_DEV_BYPASS =
  !IS_PRODUCTION && process.env.MIRA_DEV_BYPASS === "true";

console.log(
  `[CONFIG] NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}, IS_PRODUCTION=${IS_PRODUCTION}`
);
if (IS_DEV_BYPASS) {
  console.warn("[CONFIG] MIRA_DEV_BYPASS active — dev only");
}
if (IS_PRODUCTION && process.env.MIRA_DEV_BYPASS === "true") {
  console.warn("[CONFIG] MIRA_DEV_BYPASS is set in production — ignored");
}
