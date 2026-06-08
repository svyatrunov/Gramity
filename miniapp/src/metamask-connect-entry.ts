import { openGramityExternalUrl } from "./lib/openGramityExternal";
import {
  connectMetaMaskWallet,
  getMetaMaskConnectProvider,
  warmMetaMaskConnectClient,
  isMobileDevice,
  isInsideTelegramMiniApp,
  openMetaMaskLink,
  resolveMetaMaskSessionOpenUrl,
  requestFreshMetaMaskAccounts,
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
      openExternalBrowser: typeof openGramityExternalUrl;
      resolveSessionOpenUrl: typeof resolveMetaMaskSessionOpenUrl;
      requestFreshAccounts: typeof requestFreshMetaMaskAccounts;
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
  openExternalBrowser: openGramityExternalUrl,
  resolveSessionOpenUrl: resolveMetaMaskSessionOpenUrl,
  requestFreshAccounts: requestFreshMetaMaskAccounts,
};

window.dispatchEvent(new Event("gramity-metamask-ready"));
