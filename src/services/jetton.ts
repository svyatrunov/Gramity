/**
 * Reusable jetton (TEP-74) transfer / burn helper.
 * Used by the withdraw handler and the full-exit sweep.
 */

import {
  Address,
  JettonMaster,
  beginCell,
  internal,
  SendMode,
  toNano,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import type { WalletContext } from "../wallet.js";

type TypedContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

/**
 * Send a jetton transfer from the agent wallet to `toAddress`.
 */
export async function sendJettonTransfer(
  walletCtx: WalletContext,
  jettonMasterAddr: string,
  amountRaw: bigint,
  toAddress: string,
  gasValue = toNano("0.1")
): Promise<void> {
  const { key, client, contract, address } = walletCtx;
  const typedContract = contract as unknown as TypedContract;

  const jettonMaster = client.open(
    JettonMaster.create(Address.parse(jettonMasterAddr))
  );
  const jettonWalletAddr = await jettonMaster.getWalletAddress(
    Address.parse(address)
  );

  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(amountRaw)
    .storeAddress(Address.parse(toAddress))
    .storeAddress(null)
    .storeBit(false)
    .storeCoins(toNano("0.01"))
    .storeBit(false)
    .endCell();

  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(key.secretKey),
    messages: [internal({ to: jettonWalletAddr, value: gasValue, body })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  console.log(
    `[JETTON] Transferred ${amountRaw} raw → ${toAddress.slice(0, 8)}…`
  );
}

/**
 * Burn LP tokens (TEP-74 burn op 0x595f07bc) to remove liquidity.
 * The pool sends back underlying assets to the wallet.
 */
export async function burnJetton(
  walletCtx: WalletContext,
  jettonMasterAddr: string,
  amountRaw: bigint,
  gasValue = toNano("0.5")
): Promise<void> {
  const { key, client, contract, address } = walletCtx;
  const typedContract = contract as unknown as TypedContract;

  const jettonMaster = client.open(
    JettonMaster.create(Address.parse(jettonMasterAddr))
  );
  const jettonWalletAddr = await jettonMaster.getWalletAddress(
    Address.parse(address)
  );

  const body = beginCell()
    .storeUint(0x595f07bc, 32)
    .storeUint(0, 64)
    .storeCoins(amountRaw)
    .storeAddress(Address.parse(address))
    .storeBit(false)
    .endCell();

  const seqno = await typedContract.getSeqno();
  await typedContract.sendTransfer({
    seqno,
    secretKey: Buffer.from(key.secretKey),
    messages: [internal({ to: jettonWalletAddr, value: gasValue, body })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });

  console.log(`[JETTON] Burned ${amountRaw} LP from ${jettonMasterAddr.slice(0, 8)}…`);
}
