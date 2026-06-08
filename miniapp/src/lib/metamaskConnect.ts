/**
 * MetaMask Connect EVM — shared by onboarding bundle and React screens.
 */
import { createEVMClient } from "@metamask/connect-evm";
import type { MetamaskConnectEVM } from "@metamask/connect-evm";

const CHAIN_IDS = ["0x1", "0x2105", "0x38", "0x89"] as const;
type HexChainId = (typeof CHAIN_IDS)[number];

const SUPPORTED_NETWORKS: Record<string, string> = {
  "0x1": "https://rpc.ankr.com/eth",
  "0x2105": "https://rpc.ankr.com/base",
  "0x38": "https://rpc.ankr.com/bsc",
  "0x89": "https://rpc.ankr.com/polygon",
};

const MOBILE_CONNECT_TIMEOUT_MS = 120_000;

let clientPromise: Promise<MetamaskConnectEVM> | null = null;

type TelegramWebApp = {
  initData?: string;
  openLink?: (url: string) => void;
  onEvent?: (event: string, handler: () => void) => void;
};

function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function openMobileLink(link: string): void {
  const url = resolveMetaMaskOpenUrl(link);
  const tg = getTelegramWebApp();
  if (isInsideTelegramMiniApp() && tg?.openLink) {
    tg.openLink(url);
    return;
  }
  window.location.assign(url);
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
    const inTelegram = isInsideTelegramMiniApp();
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
        // Force MWP mobile deeplink in Telegram — extension path hangs in WebView
        preferExtension: inTelegram ? false : !isMobileDevice(),
      },
      mobile: {
        useDeeplink: true,
        preferredOpenLink: openMobileLink,
      },
    });
  }
  return clientPromise;
}

/** Pre-open relay WebSocket before user taps Connect (helps MWP handshake in TMA). */
export function warmMetaMaskConnectClient(): void {
  if (isInsideTelegramMiniApp() && isMobileDevice()) {
    void getMetaMaskConnectClient();
  }
}

async function readConnectedSession(
  client: MetamaskConnectEVM
): Promise<{ accounts: string[]; chainId: string } | null> {
  try {
    const provider = client.getProvider();
    const accounts = (await provider.request({ method: "eth_accounts", params: [] })) as string[];
    if (!accounts?.length) return null;
    const chainId = (await provider.request({ method: "eth_chainId", params: [] })) as string;
    return { accounts, chainId };
  } catch {
    return null;
  }
}

/**
 * MWP connect in Telegram: WebView freezes while MetaMask is foreground.
 * Relay must reconnect when user returns — nudge on visibility + long timeout.
 */
async function connectWithTelegramResume(
  client: MetamaskConnectEVM,
  chainIds: readonly HexChainId[]
): Promise<{ accounts: string[]; chainId: string }> {
  let finished = false;
  let connectError: unknown;

  const nudgeRelay = async () => {
    if (finished || document.visibilityState !== "visible") return;
    await sleep(700);
    await readConnectedSession(client);
  };

  const onVisible = () => void nudgeRelay();
  document.addEventListener("visibilitychange", onVisible);
  getTelegramWebApp()?.onEvent?.("viewportChanged", onVisible);

  const connectPromise = client
    .connect({ chainIds: [...chainIds] })
    .then((result) => {
      finished = true;
      return result;
    })
    .catch((err) => {
      connectError = err;
      throw err;
    });

  const deadline = Date.now() + MOBILE_CONNECT_TIMEOUT_MS;
  while (!finished && Date.now() < deadline) {
    const raced = await Promise.race([
      connectPromise.then((r) => ({ ok: true as const, result: r })).catch(() => ({ ok: false as const })),
      sleep(1500).then(() => ({ ok: false as const })),
    ]);
    if (raced.ok) {
      document.removeEventListener("visibilitychange", onVisible);
      return raced.result;
    }
    const session = await readConnectedSession(client);
    if (session) {
      finished = true;
      document.removeEventListener("visibilitychange", onVisible);
      return session;
    }
  }

  document.removeEventListener("visibilitychange", onVisible);

  if (!finished) {
    const session = await readConnectedSession(client);
    if (session) return session;
    if (connectError) throw connectError;
    throw new Error("MetaMask connect timeout — approve in MetaMask and return to Telegram");
  }

  throw new Error("MetaMask connect failed");
}

export async function connectMetaMaskWallet(): Promise<{
  accounts: string[];
  chainId: string;
}> {
  const client = await getMetaMaskConnectClient();
  const chainIds = [...CHAIN_IDS];

  if (isInsideTelegramMiniApp() && isMobileDevice()) {
    return connectWithTelegramResume(client, chainIds);
  }

  return client.connect({ chainIds: [...chainIds] });
}

export async function getMetaMaskConnectProvider() {
  const client = await getMetaMaskConnectClient();
  return client.getProvider();
}

/** Legacy extension-only provider (desktop browser outside Telegram). */
export function getBrowserExtensionProvider(): Eip1193Provider | null {
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

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
}
