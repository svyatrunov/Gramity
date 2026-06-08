import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  needsExternalBrowserForMetaMask,
  redirectToExternalBrowserForMetaMask,
  isMobileDevice,
  isInsideTelegramMiniApp,
} from "./lib/metamaskConnect";

declare global {
  interface Window {
    GramityMetaMask?: {
      connect: typeof connectMetaMaskWallet;
      getProvider: typeof getMetaMaskConnectProvider;
      needsExternalBrowser: typeof needsExternalBrowserForMetaMask;
      redirectToExternalBrowser: typeof redirectToExternalBrowserForMetaMask;
      isMobileDevice: typeof isMobileDevice;
      isInsideTelegramMiniApp: typeof isInsideTelegramMiniApp;
    };
  }
}

window.GramityMetaMask = {
  connect: connectMetaMaskWallet,
  getProvider: getMetaMaskConnectProvider,
  needsExternalBrowser: needsExternalBrowserForMetaMask,
  redirectToExternalBrowser: redirectToExternalBrowserForMetaMask,
  isMobileDevice,
  isInsideTelegramMiniApp,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
