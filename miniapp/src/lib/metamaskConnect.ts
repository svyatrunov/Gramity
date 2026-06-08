/**
 * MetaMask Connect EVM — shared by onboarding bundle and React screens.
 */
import { createEVMClient } from "@metamask/connect-evm";
import type { MetamaskConnectEVM } from "@metamask/connect-evm";
import { openGramityExternalUrl } from "./openGramityExternal";

const CHAIN_IDS = ["0x1", "0x2105", "0x38", "0x89"] as const;

const SUPPORTED_NETWORKS: Record<string, string> = {
  "0x1": "https://rpc.ankr.com/eth",
  "0x2105": "https://rpc.ankr.com/base",
  "0x38": "https://rpc.ankr.com/bsc",
  "0x89": "https://rpc.ankr.com/polygon",
};

let clientPromise: Promise<MetamaskConnectEVM> | null = null;

type TelegramWebApp = {
  initData?: string;
  openLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
};

function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent ?? "");
}

/** initData only from Telegram WebApp — never from URL (external browser has no valid session). */
export function getTelegramInitData(): string {
  const tgData = getTelegramWebApp()?.initData;
  if (tgData && tgData.includes("hash=")) return tgData;
  return "";
}

export function isInsideTelegramMiniApp(): boolean {
  const tg = getTelegramWebApp();
  return Boolean(tg?.initData && tg.initData.includes("hash="));
}

function isAndroidDevice(): boolean {
  return /Android/i.test(navigator.userAgent ?? "");
}

/** Android: intent:// bypasses Branch.io in-app-browser fallback inside Telegram WebView. */
function buildAndroidMetaMaskIntent(metamaskLink: string): string {
  const path = metamaskLink.replace(/^metamask:\/\//, "");
  const fallback = encodeURIComponent("https://metamask.io/download/");
  return `intent://${path}#Intent;scheme=metamask;package=io.metamask;S.browser_fallback_url=${fallback};end`;
}

function toMetamaskScheme(link: string): string {
  if (link.startsWith("metamask://")) return link;
  if (link.includes("metamask.app.link") || link.includes("link.metamask.io")) {
    try {
      const u = new URL(link);
      return `metamask://${u.pathname.replace(/^\//, "")}${u.search}`;
    } catch {
      return link;
    }
  }
  return link;
}

function resolveMetaMaskOpenUrl(link: string): string {
  const schemeLink = toMetamaskScheme(link);

  if (isAndroidDevice() && schemeLink.startsWith("metamask://")) {
    return buildAndroidMetaMaskIntent(schemeLink);
  }

  // iOS: app.link via Safari (Universal Links) — never window.location inside TG WebView
  if (schemeLink.startsWith("metamask://")) {
    return schemeLink.replace("metamask://", "https://metamask.app.link/");
  }
  return link;
}

function isPlainHttpUrl(link: string): boolean {
  return /^https?:\/\//i.test(link);
}

function isMetaMaskDeeplinkHost(link: string): boolean {
  return (
    link.includes("link.metamask.io") ||
    link.includes("metamask.app.link") ||
    link.startsWith("metamask://") ||
    link.startsWith("intent://")
  );
}

/** Open dapp page in the system browser (Chrome + MetaMask extension on desktop TMA). */
export function openExternalBrowser(link: string): void {
  openGramityExternalUrl(link);
}

function openMobileLink(link: string): void {
  const url = resolveMetaMaskOpenUrl(link);
  const tg = getTelegramWebApp();
  if (isInsideTelegramMiniApp() && tg?.openLink) {
    tg.openLink(url);
    return;
  }
  window.location.assign(url);
}

/** Plain https pageUrl → system browser; metamask:// / link.metamask.io → MetaMask app. */
export function openMetaMaskLink(link: string): void {
  if (isPlainHttpUrl(link) && !isMetaMaskDeeplinkHost(link)) {
    openExternalBrowser(link);
    return;
  }
  openMobileLink(link);
}

/** Mobile: link.metamask.io opens MetaMask in-app browser. Desktop: direct pageUrl (extension in system browser). */
export function resolveMetaMaskSessionOpenUrl(session: {
  metamaskUrl: string;
  pageUrl: string;
}): string {
  if (isMobileDevice()) return session.metamaskUrl;
  return session.pageUrl;
}

/** Route metamask:// / app.link through tg.openLink (Telegram WebView blocks raw deeplinks). */
function installTelegramOpenLinkPatch(): void {
  if (!isInsideTelegramMiniApp()) return;
  const tg = getTelegramWebApp();
  if (!tg?.openLink) return;

  const originalOpen = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = typeof url === "string" ? url : url?.toString() ?? "";
    if (
      href.startsWith("metamask://") ||
      href.startsWith("intent://") ||
      href.includes("metamask.app.link") ||
      href.includes("link.metamask.io")
    ) {
      openMobileLink(href);
      return null;
    }
    return originalOpen(url, target, features);
  };
}

export function getMetaMaskConnectClient(): Promise<MetamaskConnectEVM> {
  if (!clientPromise) {
    installTelegramOpenLinkPatch();
    clientPromise = createEVMClient({
      dapp: {
        name: "Gramity",
        url: `${window.location.origin}/app/onboarding.html`,
        iconUrl: `${window.location.origin}/app/logos/ton.png`,
      },
      api: {
        supportedNetworks: SUPPORTED_NETWORKS,
      },
      ui: {
        headless: true,
        // Mobile: deeplink to MetaMask app. Desktop (incl. Telegram WebView): MWP relay → Chrome extension.
        preferExtension: !isMobileDevice(),
      },
      mobile: {
        useDeeplink: true,
        preferredOpenLink: openMobileLink,
      },
    });
  }
  return clientPromise;
}

/** Pre-open relay WebSocket before user taps Connect (mobile TMA only). */
export function warmMetaMaskConnectClient(): void {
  if (isInsideTelegramMiniApp() && isMobileDevice()) {
    void getMetaMaskConnectClient();
  }
}

export async function connectMetaMaskWallet(): Promise<{
  accounts: string[];
  chainId: string;
}> {
  if (isInsideTelegramMiniApp()) {
    throw new Error(
      "Open Gramity in the MetaMask browser session — MWP relay is disabled inside Telegram"
    );
  }

  const client = await getMetaMaskConnectClient();
  return client.connect({ chainIds: [...CHAIN_IDS] });
}

export async function getMetaMaskConnectProvider() {
  const client = await getMetaMaskConnectClient();
  return client.getProvider();
}

/** Real in-page extension only — not MWP relay inside Telegram WebView. */
export function getBrowserExtensionProvider(): Eip1193Provider | null {
  if (isInsideTelegramMiniApp()) return null;
  const eth = (window as unknown as { ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] } }).ethereum;
  if (!eth) return null;
  if (eth.providers?.length) {
    return (
      eth.providers.find(
        (p) => (p as { isMetaMask?: boolean; isPhantom?: boolean }).isMetaMask &&
          !(p as { isPhantom?: boolean }).isPhantom
      ) ?? null
    );
  }
  if (eth.isMetaMask && !(eth as { isPhantom?: boolean }).isPhantom) return eth;
  return null;
}

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
}

/**
 * Force MetaMask connect popup — clears stale site permission then re-requests accounts.
 * eth_requestAccounts alone returns the first authorized account without a popup.
 */
export async function requestFreshMetaMaskAccounts(
  provider: Eip1193Provider,
  options: { revokeFirst?: boolean } = { revokeFirst: true }
): Promise<string[]> {
  if (options.revokeFirst) {
    try {
      await provider.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      /* site was not connected yet */
    }
  }

  try {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }],
    });
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 4001) throw new Error("Connection rejected in MetaMask");
    throw err;
  }

  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.length) {
    throw new Error("MetaMask returned no accounts");
  }
  return accounts;
}
