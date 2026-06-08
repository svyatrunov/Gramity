import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
  openMetaMaskLink,
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
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
