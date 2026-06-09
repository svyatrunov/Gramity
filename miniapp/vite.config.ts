import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  base: "/app/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/mcp": "http://localhost:3000",
    },
  },
  build: {
    outDir: "../dist-miniapp",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        evmDeposit: resolve(__dirname, "evm-deposit.html"),
        evmWallet: resolve(__dirname, "evm-wallet.html"),
        metamaskConnect: resolve(__dirname, "src/metamask-connect-entry.ts"),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "metamaskConnect") return "assets/metamask-connect.js";
          if (chunk.name === "evmDeposit") return "assets/evm-deposit-[hash].js";
          if (chunk.name === "evmWallet") return "assets/evm-wallet-[hash].js";
          return "assets/[name]-[hash].js";
        },
      },
    },
  },
});
