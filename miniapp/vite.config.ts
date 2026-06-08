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
    },
  },
  build: {
    outDir: "../dist-miniapp",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        metamaskConnect: resolve(__dirname, "src/metamask-connect-entry.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "metamaskConnect"
            ? "assets/metamask-connect.js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});
