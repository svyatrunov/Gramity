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

function openMobileLink(link: string): void {
  const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } })
    .Telegram?.WebApp;
  if (tg?.openLink) {
    tg.openLink(link);
    return;
  }
  window.open(link, "_blank", "noopener,noreferrer");
}

export function getMetaMaskConnectClient(): Promise<MetamaskConnectEVM> {
  if (!clientPromise) {
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
        preferExtension: true,
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
