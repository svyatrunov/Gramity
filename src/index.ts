/**
 * Gramity — Main Entry Point
 * Starts: HTTP health check + Telegram bot + Cron scheduler
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as http from "http";
import { startBot } from "./bot/index.js";
import { startScheduler } from "./scheduler/index.js";
import { initDb } from "./db/index.js";
import { PORT } from "./config.js";

// ─── Health check server (required by Railway) ────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "gramity", ts: Date.now() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const port = Number(PORT) || 3000;
server.listen(port, () => {
  console.log(`[HTTP] Health check server listening on port ${port}`);
});

// ─── Start bot + scheduler ────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════╗
║          GRAMITY — TON DCA Liquidity Bot                 ║
║          Starting up...                                  ║
╚══════════════════════════════════════════════════════════╝
`);

initDb()
  .then(() => {
    startScheduler();
    return startBot();
  })
  .catch((err) => {
    console.error("[FATAL] Startup failed:", err);
    process.exit(1);
  });
