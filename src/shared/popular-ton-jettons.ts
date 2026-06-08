/**
 * Единый реестр популярных TON-токенов для sweep, scan UI и иконок.
 */

import { Address } from "@ton/ton";
import { USDT_ADDRESS, TSTON_ADDRESS } from "../config.js";

export interface PopularTonJetton {
  symbol: string;
  /** "ton" для нативного TON, иначе jetton master (EQ…) */
  address: string;
  /** Путь к растровому лого под /app; пустая строка → SVG symbol по logoId */
  logoPath: string;
  /** id inline SVG symbol в onboarding.html */
  logoId: string;
}

/** STON jetton master — mainnet */
export const STON_ADDRESS =
  "EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmn32ehfw";

/** NOT jetton master — mainnet */
export const NOT_ADDRESS =
  "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT";

export const POPULAR_TON_JETTONS: PopularTonJetton[] = [
  { symbol: "TON",   address: "ton",         logoPath: "/app/logos/ton.png",   logoId: "logo-ton" },
  { symbol: "tsTON", address: TSTON_ADDRESS, logoPath: "/app/logos/tston.svg", logoId: "logo-tston" },
  { symbol: "STON",  address: STON_ADDRESS,  logoPath: "/app/logos/ston.png",  logoId: "logo-ston" },
  { symbol: "NOT",   address: NOT_ADDRESS,   logoPath: "",                     logoId: "logo-wallet" },
  { symbol: "USDT",  address: USDT_ADDRESS,  logoPath: "/app/logos/usdt.png",  logoId: "logo-usdt" },
];

export function normalizeJettonAddress(addr: string): string {
  try {
    return Address.parse(addr).toString();
  } catch {
    return addr.toLowerCase();
  }
}

const POPULAR_JETTON_ADDRESS_SET = new Set(
  POPULAR_TON_JETTONS
    .filter((t) => t.address !== "ton")
    .map((t) => normalizeJettonAddress(t.address))
);

/** Проверяет, входит ли jetton master в реестр популярных токенов. */
export function isPopularJettonAddress(addr: string): boolean {
  return POPULAR_JETTON_ADDRESS_SET.has(normalizeJettonAddress(addr));
}

export function logoUrlFor(token: PopularTonJetton): string | null {
  return token.logoPath || null;
}
