import { mnemonicNew, mnemonicToWalletKey } from "@ton/crypto";
import { WalletContractV4 } from "@ton/ton";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const mnemonic = await mnemonicNew();
  const key = await mnemonicToWalletKey(mnemonic);

  const wallet = WalletContractV4.create({
    publicKey: key.publicKey,
    workchain: 0,
  });

  const address = wallet.address.toString({ urlSafe: true, bounceable: true });

  const envPath = path.resolve(process.cwd(), ".env");
  const mnemonicLine = `BACKEND_WALLET_MNEMONIC="${mnemonic.join(" ")}"`;

  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, "utf-8");
    if (/^BACKEND_WALLET_MNEMONIC=/m.test(content)) {
      content = content.replace(
        /^BACKEND_WALLET_MNEMONIC=.*$/m,
        mnemonicLine
      );
    } else {
      content = mnemonicLine + "\n" + content;
    }
    fs.writeFileSync(envPath, content, "utf-8");
  } else {
    fs.writeFileSync(envPath, mnemonicLine + "\n", "utf-8");
  }

  console.log("Адрес кошелька:", address);
  console.log(
    "Мнемоника записана в .env — не показывай её никому и никуда не копируй"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
