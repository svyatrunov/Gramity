import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  isMobileDevice,
  isInsideTelegramMiniApp,
} from "./lib/metamaskConnect";

declare global {
  interface Window {
    GramityMetaMask?: {
      connect: typeof connectMetaMaskWallet;
      getProvider: typeof getMetaMaskConnectProvider;
      isMobileDevice: typeof isMobileDevice;
      isInsideTelegramMiniApp: typeof isInsideTelegramMiniApp;
    };
  }
}

window.GramityMetaMask = {
  connect: connectMetaMaskWallet,
  getProvider: getMetaMaskConnectProvider,
  isMobileDevice,
  isInsideTelegramMiniApp,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
