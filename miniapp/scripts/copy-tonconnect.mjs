import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "node_modules/@tonconnect/ui/dist/tonconnect-ui.min.js");
const destDir = join(root, "public/assets");
const dest = join(destDir, "tonconnect-ui.min.js");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-tonconnect] copied tonconnect-ui.min.js");
