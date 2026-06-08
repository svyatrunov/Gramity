# Gramity — Agentic DCA Wallet on TON

> Built for **STON.fi Vibe Coding Hackathon Cohort 2**  
> Track: **STON.fi** (Omniston v1beta8) + **Mira AI**  
> Live: [https://gramity-production.up.railway.app](https://gramity-production.up.railway.app)

[![Live on Mainnet](https://img.shields.io/badge/TON-Mainnet-blue)]()
[![Omniston SDK](https://img.shields.io/badge/Omniston-v1beta8-blue)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-green)]()
[![STON.fi](https://img.shields.io/badge/Powered%20by-STON.fi-purple)]()

---

> Gramity is an agentic wallet orchestrator that automatically converts your USDT into LP positions on TON — from any chain, without any manual steps.

---

## The Problem

Manually executing DCA into LP positions requires:

- Bridge EVM → TON: 5 min
- Omniston swap: 3 min
- Tonstakers stake: 3 min
- STON.fi LP add: 5 min

**= 16 min per cycle = 97 hours/year**

**With Gramity: 0 min. One deposit, endless automation.**

---

## How It Works

1. 💰 **Deposit USDT** from any chain (ETH/Base/BNB/Polygon via MetaMask or TON directly)
2. 🔄 **Omniston** routes via best-price RFQ across all TON DEXes
3. ⚡ **Tonstakers** liquid staking → tsTON (5.4% APY)
4. 💎 **STON.fi DEX v2** LP position created
5. 🔒 **LP tokens** sent directly to your locked withdrawal wallet

---

## Mira AI Integration

Gramity exposes an MCP server for conversational control after Mini App onboarding.

- **MCP manifest:** [/.well-known/mcp.json](https://gramity-production.up.railway.app/.well-known/mcp.json)
- **Endpoint:** `POST /mcp` — tools: `get_portfolio`, `create_strategy`, `pause_strategy`
- **Handoff:** Mini App → `POST /api/mira/create-context` → `@Mira` deeplink with portfolio context

**Example dialog:**

```
User: "How's my Gramity DCA doing?"
Mira: [calls get_portfolio] "2 cycles complete. $14 invested. +0.8%"

User: "Increase to $25/week"
Mira: [calls create_strategy] "Done. Next cycle uses $25."
```

---

## Onboarding — Step 1

<img src="docs/screenshots/onboarding-step1.png" alt="Gramity Onboarding Step 1" width="380" />

---

## Key Differentiators

- **Mainnet only** — real transactions, verifiable on tonviewer  
  Run `/test` in [@GramityBot](https://t.me/GramityBot) — each cycle posts swap/stake/LP links.  
  Latest example: [tonviewer.com/transaction/…](https://gramity-production.up.railway.app/api/example-tx) (redirects when available)
- **No mocks** — full Omniston SDK v0.8.3 (v1beta8) with RFQ WebSocket, swapTrack, EIP-712, HTLC cross-chain settlement
- **Agentic wallet architecture** — per-user isolated wallets, AES-256-GCM encrypted mnemonics, withdrawal address locked at setup.  
  Reference: [https://docs.ton.org/overview/ai/wallets](https://docs.ton.org/overview/ai/wallets)

---

## Security Model

| Layer | Detail |
|---|---|
| Withdrawal address | Locked at plan creation — agent cannot redirect funds |
| Encryption | AES-256-GCM with random IV per wallet |
| Auth | HMAC-SHA256 Telegram initData validation |
| Custody | Agent holds DCA funds; LP tokens exit immediately |

---

## Business Model

- **0%** platform fee
- **0.1%** integrator fee on every Omniston swap (paid by resolver)
- **Roadmap:** Pro subscription for multi-strategy + analytics

---

## Live Demo

- Bot: [https://t.me/GramityBot](https://t.me/GramityBot)
- App: [https://gramity-production.up.railway.app/app/onboarding.html](https://gramity-production.up.railway.app/app/onboarding.html)

---

## Tech Stack

| Category | Technologies |
|---|---|
| Bot framework | grammY |
| Runtime | Node.js |
| Database | PostgreSQL |
| Hosting | Railway |
| Cross-chain | Omniston SDK v0.8.3 (v1beta8) |
| DEX | STON.fi SDK v2 |
| Staking | Tonstakers SDK |
| EVM | ethers.js v6 |
| Frontend | Telegram Mini App |
| AI control | Mira MCP integration |

---

## Built with AI

- **Cursor Agent** (claude-sonnet-4.5) — architecture, code, UI
- **Claude** (Anthropic) — strategy, prompts, audit

---

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```
