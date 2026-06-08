/**
 * Admin: wipe plan + deposit wallet for one Telegram user.
 * Usage: TELEGRAM_ID=123456789 npx ts-node src/scripts/reset-user.ts
 *    or: npx ts-node src/scripts/reset-user.ts 123456789
 */
import "dotenv/config";
import { deleteUserAccount, getPlanByTelegramId, getUserWallets } from "../db/index.js";
import { clearEvmWalletSessionsForTelegram } from "../services/evmWalletSession.js";

async function main() {
  const raw = process.argv[2] ?? process.env.TELEGRAM_ID;
  const telegramId = Number(raw);
  if (!Number.isFinite(telegramId) || telegramId <= 0) {
    console.error("Usage: TELEGRAM_ID=<id> npx ts-node src/scripts/reset-user.ts");
    process.exit(1);
  }

  const [plan, wallets] = await Promise.all([
    getPlanByTelegramId(telegramId).catch(() => null),
    getUserWallets(telegramId).catch(() => []),
  ]);

  if (!plan && wallets.length === 0) {
    clearEvmWalletSessionsForTelegram(telegramId);
    console.log(`No plan or deposit wallet for telegram_id=${telegramId} (EVM sessions cleared)`);
    process.exit(0);
  }

  await deleteUserAccount(telegramId);
  clearEvmWalletSessionsForTelegram(telegramId);
  console.log(`Deleted account data for telegram_id=${telegramId}`);
  if (plan) console.log(`  plan: $${plan.usdt_amount} ${plan.frequency}`);
  if (wallets[0]) console.log(`  wallet: ${wallets[0].wallet_address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
