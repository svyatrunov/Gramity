/**
 * One-time recovery script: withdraw LP + tsTON + USDT + TON
 * from the OLD backend wallet (BACKEND_WALLET_MNEMONIC) to RECIPIENT_ADDRESS.
 *
 * Usage:
 *   RECIPIENT_ADDRESS=EQ... npm run recover
 *
 * This is needed when the per-user wallet migration wasn't run before
 * users already had a new wallet created, leaving LP tokens on the old wallet.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { mnemonicToWalletKey } from "@ton/crypto";
import {
  WalletContractV4,
  TonClient,
  Address,
  JettonMaster,
  JettonWallet,
  internal,
  SendMode,
  fromNano,
  toNano,
} from "@ton/ton";
import { TONCENTER_URL, TONCENTER_API_KEY, POOL_ADDRESS, TSTON_ADDRESS, USDT_ADDRESS } from "../config.js";

const RECIPIENT = process.env.RECIPIENT_ADDRESS;
if (!RECIPIENT) {
  console.error("ERROR: Set RECIPIENT_ADDRESS env var");
  console.error("Usage: RECIPIENT_ADDRESS=EQ... npm run recover");
  process.exit(1);
}

const MNEMONIC = process.env.BACKEND_WALLET_MNEMONIC;
if (!MNEMONIC) {
  console.error("ERROR: BACKEND_WALLET_MNEMONIC is not set");
  process.exit(1);
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function getJettonBalance(
  client: TonClient,
  walletAddress: string,
  jettonMasterAddr: string
): Promise<bigint> {
  try {
    const master = client.open(
      JettonMaster.create(Address.parse(jettonMasterAddr))
    );
    const userJettonWalletAddr = await master.getWalletAddress(
      Address.parse(walletAddress)
    );
    const userJettonWallet = client.open(
      JettonWallet.create(userJettonWalletAddr)
    );
    return await userJettonWallet.getBalance();
  } catch {
    return 0n;
  }
}

async function sendJettonTransfer(
  contract: any,
  key: any,
  client: TonClient,
  walletAddress: string,
  jettonMasterAddr: string,
  amount: bigint,
  toAddress: string,
  gasValue = toNano("0.1")
) {
  const { beginCell } = await import("@ton/ton");
  const master = client.open(JettonMaster.create(Address.parse(jettonMasterAddr)));
  const jettonWalletAddr = await master.getWalletAddress(Address.parse(walletAddress));

  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(toAddress))
    .storeAddress(null)
    .storeBit(false)
    .storeCoins(toNano("0.01"))
    .storeBit(false)
    .endCell();

  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    seqno,
    secretKey: Buffer.from(key.secretKey),
    messages: [internal({ to: jettonWalletAddr, value: gasValue, body })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
}

async function burnJetton(
  contract: any,
  key: any,
  client: TonClient,
  walletAddress: string,
  jettonMasterAddr: string,
  amount: bigint,
  gasValue = toNano("0.5")
) {
  const { beginCell } = await import("@ton/ton");
  const master = client.open(JettonMaster.create(Address.parse(jettonMasterAddr)));
  const jettonWalletAddr = await master.getWalletAddress(Address.parse(walletAddress));

  const body = beginCell()
    .storeUint(0x595f07bc, 32)
    .storeUint(0, 64)
    .storeCoins(amount)
    .storeAddress(Address.parse(walletAddress))
    .storeBit(false)
    .endCell();

  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    seqno,
    secretKey: Buffer.from(key.secretKey),
    messages: [internal({ to: jettonWalletAddr, value: gasValue, body })],
    sendMode: SendMode.PAY_GAS_SEPARATELY,
  });
}

async function main() {
  console.log("=== Gramity Old Wallet Recovery ===");
  console.log(`Recipient: ${RECIPIENT}`);

  const key = await mnemonicToWalletKey(MNEMONIC!.split(" "));
  const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });
  const client = new TonClient({
    endpoint: TONCENTER_URL,
    apiKey: TONCENTER_API_KEY || undefined,
  });
  const contract = client.open(wallet) as any;
  const address = wallet.address.toString({ urlSafe: true, bounceable: false });

  console.log(`Old wallet: ${address}`);

  const tonBalance = await client.getBalance(wallet.address);
  console.log(`TON balance: ${fromNano(tonBalance)} TON`);

  // Step 1: Burn LP tokens
  const lpBalance = await getJettonBalance(client, address, POOL_ADDRESS);
  console.log(`LP balance: ${fromNano(lpBalance)} LP tokens`);

  if (lpBalance > 0n) {
    console.log("Burning LP tokens...");
    await burnJetton(contract, key, client, address, POOL_ADDRESS, lpBalance);
    console.log("LP burn sent. Waiting 90s for TON + tsTON to arrive...");
    await sleep(90_000);
  } else {
    console.log("No LP tokens found.");
  }

  // Step 2: Burn tsTON
  const tstonBalance = await getJettonBalance(client, address, TSTON_ADDRESS);
  console.log(`tsTON balance: ${fromNano(tstonBalance)} tsTON`);

  if (tstonBalance > 0n) {
    console.log("Burning tsTON for instant unstake...");
    await burnJetton(contract, key, client, address, TSTON_ADDRESS, tstonBalance);
    console.log("tsTON burn sent. Waiting 30s...");
    await sleep(30_000);
  } else {
    console.log("No tsTON found.");
  }

  // Step 3: Send USDT
  const usdtBalance = await getJettonBalance(client, address, USDT_ADDRESS);
  console.log(`USDT balance: ${Number(usdtBalance) / 1e6} USDT`);

  if (usdtBalance > 0n) {
    console.log(`Sending ${Number(usdtBalance) / 1e6} USDT to ${RECIPIENT}...`);
    await sendJettonTransfer(contract, key, client, address, USDT_ADDRESS, usdtBalance, RECIPIENT!);
    console.log("USDT sent.");
    await sleep(3_000);
  }

  // Step 4: Send remaining TON
  const tonBalanceNow = await client.getBalance(wallet.address);
  const GAS_RESERVE = toNano("0.15");
  const sendableTon = tonBalanceNow > GAS_RESERVE ? tonBalanceNow - GAS_RESERVE : 0n;

  if (sendableTon > toNano("0.05")) {
    console.log(`Sending ${fromNano(sendableTon)} TON to ${RECIPIENT}...`);
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      seqno,
      secretKey: Buffer.from(key.secretKey),
      messages: [
        internal({
          to: Address.parse(RECIPIENT!),
          value: sendableTon,
          bounce: false,
        }),
      ],
      sendMode: SendMode.PAY_GAS_SEPARATELY,
    });
    console.log("TON sent.");
  }

  console.log("\n=== Recovery complete ===");
  console.log(`Check recipient wallet: https://tonviewer.com/${RECIPIENT}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
