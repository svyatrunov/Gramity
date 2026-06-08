import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
} from "./lib/metamaskConnect";

declare global {
  interface Window {
    GramityMetaMask?: {
      connect: typeof connectMetaMaskWallet;
      getProvider: typeof getMetaMaskConnectProvider;
    };
  }
}

window.GramityMetaMask = {
  connect: connectMetaMaskWallet,
  getProvider: getMetaMaskConnectProvider,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
