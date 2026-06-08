import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
} from "./lib/metamaskConnect";

declare global {
  interface Window {
    GramityMetaMask?: {
      connect: typeof connectMetaMaskWallet;
      getProvider: typeof getMetaMaskConnectProvider;
      warm: typeof warmMetaMaskConnectClient;
      isMobileDevice: typeof isMobileDevice;
      isInsideTelegramMiniApp: typeof isInsideTelegramMiniApp;
    };
  }
}

window.GramityMetaMask = {
  connect: connectMetaMaskWallet,
  getProvider: getMetaMaskConnectProvider,
  warm: warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
