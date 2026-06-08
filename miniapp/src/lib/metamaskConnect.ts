/**
 * MetaMask Connect EVM — shared by onboarding bundle and React screens.
 */
import { createEVMClient } from "@metamask/connect-evm";
import type { MetamaskConnectEVM } from "@metamask/connect-evm";

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

function normalizeMetaMaskLink(link: string): string {
  if (link.startsWith("metamask://")) {
    return link.replace("metamask://", "https://metamask.app.link/");
  }
  return link;
}

function openMobileLink(link: string): void {
  const url = normalizeMetaMaskLink(link);
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

export async function connectMetaMaskWallet(): Promise<{
  accounts: string[];
  chainId: string;
}> {
  const client = await getMetaMaskConnectClient();
  const result = await client.connect({ chainIds: [...CHAIN_IDS] });
  return { accounts: result.accounts, chainId: result.chainId };
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
