/**
 * Seed agent wallets with native TON for first-cycle gas.
 * Uses the backend hot wallet (BACKEND_WALLET_MNEMONIC).
 */

import {
  Address,
  internal,
  SendMode,
  toNano,
  fromNano,
  type OpenedContract,
  WalletContractV4,
} from "@ton/ton";
import { GAS_RESERVE_TON } from "../constants/dca.js";
import { createWallet } from "../wallet.js";
import { getTonBalance } from "./tonapi.js";

/** TON sent once when agent wallet has no gas buffer */
export const GAS_SEED_TON = Number(process.env.GAS_SEED_TON ?? "0.6");

type TransferContract = OpenedContract<WalletContractV4> & {
  getSeqno(): Promise<number>;
  sendTransfer(p: {
    seqno: number;
    secretKey: Buffer;
    messages: ReturnType<typeof internal>[];
    sendMode: number;
  }): Promise<void>;
};

/** If agent wallet TON balance is below reserve, send seed from platform wallet. */
export async function seedGasIfNeeded(agentAddress: string): Promise<{
  seeded: boolean;
  amountTon?: number;
  reason?: string;
}> {
  if (GAS_SEED_TON <= 0) {
    return { seeded: false, reason: "gas_seed_disabled" };
  }

  let tonBalance = 0;
  try {
    const nano = await getTonBalance(agentAddress);
    tonBalance = Number(nano) / 1e9;
  } catch {
    tonBalance = 0;
  }

  if (tonBalance >= GAS_RESERVE_TON) {
    return { seeded: false, reason: "sufficient_gas" };
  }

  try {
    const bot = await createWallet();
    const botNano = await bot.client.getBalance(Address.parse(bot.address));
    const seedNano = toNano(String(GAS_SEED_TON));
    const reserveNano = toNano("0.2");

    if (botNano <= seedNano + reserveNano) {
      console.warn(
        `[GAS-SEED] Bot wallet low: ${fromNano(botNano)} TON — skip seed for ${agentAddress}`
      );
      return { seeded: false, reason: "bot_wallet_low" };
    }

    const contract = bot.contract as unknown as TransferContract;
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      seqno,
      secretKey: Buffer.from(bot.key.secretKey),
      messages: [
        internal({
          to: Address.parse(agentAddress),
          value: seedNano,
          bounce: false,
        }),
      ],
      sendMode: SendMode.PAY_GAS_SEPARATELY,
    });

    console.log(
      `[GAS-SEED] Sent ${GAS_SEED_TON} TON → ${agentAddress.slice(0, 8)}… (was ${tonBalance.toFixed(3)} TON)`
    );
    return { seeded: true, amountTon: GAS_SEED_TON };
  } catch (err) {
    console.warn("[GAS-SEED] Failed:", (err as Error).message);
    return { seeded: false, reason: (err as Error).message };
  }
}
