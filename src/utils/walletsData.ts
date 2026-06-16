import {
  Slice,
  StateInit,
  WalletContractV1R1,
  WalletContractV1R2,
  WalletContractV1R3,
  WalletContractV2R1,
  WalletContractV2R2,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5Beta,
  WalletContractV5R1,
} from "@ton/ton";

const knownWallets = [
  { contract: WalletContractV1R1, loadData: loadWalletV1Data },
  { contract: WalletContractV1R2, loadData: loadWalletV1Data },
  { contract: WalletContractV1R3, loadData: loadWalletV1Data },
  { contract: WalletContractV2R1, loadData: loadWalletV2Data },
  { contract: WalletContractV2R2, loadData: loadWalletV2Data },
  { contract: WalletContractV3R1, loadData: loadWalletV3Data },
  { contract: WalletContractV3R2, loadData: loadWalletV3Data },
  { contract: WalletContractV4, loadData: loadWalletV4Data },
  { contract: WalletContractV5Beta, loadData: loadWalletV5BetaData },
  { contract: WalletContractV5R1, loadData: loadWalletV5Data },
].map(({ contract, loadData }) => ({
  contract,
  loadData,
  wallet: contract.create({ workchain: 0, publicKey: Buffer.alloc(32) }),
}));

function loadWalletV1Data(cs: Slice) {
  cs.loadUint(32);
  return { publicKey: cs.loadBuffer(32) };
}

function loadWalletV2Data(cs: Slice) {
  cs.loadUint(32);
  return { publicKey: cs.loadBuffer(32) };
}

function loadWalletV3Data(cs: Slice) {
  cs.loadUint(32);
  cs.loadUint(32);
  return { publicKey: cs.loadBuffer(32) };
}

function loadWalletV4Data(cs: Slice) {
  cs.loadUint(32);
  cs.loadUint(32);
  return { publicKey: cs.loadBuffer(32) };
}

function loadWalletV5BetaData(cs: Slice) {
  cs.loadBoolean();
  cs.loadUint(32);
  cs.loadUintBig(80);
  return { publicKey: cs.loadBuffer(32) };
}

function loadWalletV5Data(cs: Slice) {
  cs.loadBoolean();
  cs.loadUint(32);
  cs.loadUint(32);
  return { publicKey: cs.loadBuffer(32) };
}

export function tryParsePublicKey(stateInit: StateInit): Buffer | null {
  if (!stateInit.code || !stateInit.data) return null;

  for (const { wallet, loadData } of knownWallets) {
    try {
      if (wallet.init.code.equals(stateInit.code)) {
        return loadData(stateInit.data.beginParse()).publicKey;
      }
    } catch {
      /* try next wallet version */
    }
  }

  return null;
}
