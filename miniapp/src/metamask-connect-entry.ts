import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
  openMetaMaskLink,
  openExternalBrowser,
  resolveMetaMaskSessionOpenUrl,
} from "./lib/metamaskConnect";

declare global {
  interface Window {
    GramityMetaMask?: {
      connect: typeof connectMetaMaskWallet;
      getProvider: typeof getMetaMaskConnectProvider;
      warm: typeof warmMetaMaskConnectClient;
      isMobileDevice: typeof isMobileDevice;
      isInsideTelegramMiniApp: typeof isInsideTelegramMiniApp;
      openLink: typeof openMetaMaskLink;
      openExternalBrowser: typeof openExternalBrowser;
      resolveSessionOpenUrl: typeof resolveMetaMaskSessionOpenUrl;
    };
  }
}

window.GramityMetaMask = {
  connect: connectMetaMaskWallet,
  getProvider: getMetaMaskConnectProvider,
  warm: warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
  openLink: openMetaMaskLink,
  openExternalBrowser,
  resolveSessionOpenUrl: resolveMetaMaskSessionOpenUrl,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
