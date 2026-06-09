# Gramity — Automated DCA on TON

> **[STON.fi](http://STON.fi) Vibe Coding Hackathon Cohort 2** · Omniston v1beta8  
> Live: [gramity-production.up.railway.app](http://gramity-production.up.railway.app) · Bot: [@GramityBot](https://t.me/GramityBot)

Deposit USDT from any chain. Every cycle: Omniston swap → Tonstakers stake → [STON.fi](http://STON.fi) LP. Hands-free.

---

## Live on mainnet

Agent wallet: `UQCOkJ...X2sAU`


| Cycle      | Swap                                                                                                           | Stake                                                                                                          | LP                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Jun 8 · $5 | [38e0896d](https://tonviewer.com/transaction/38e0896d58b6f31e681ec75c6e5232c67f6a0355c4acab076e115151822c7bda) | [6feef992](https://tonviewer.com/transaction/6feef992c8c403a67d64b79420dd90cd5999a402d84bd0c77ca9c64e0658370e) | [6ea7e695](https://tonviewer.com/transaction/6ea7e695659b27a4b7b4acff4178fccf50c54ac8e6c8bd3059e055285c25361e) |
| Jun 8 · $5 | [6ea7e695](https://tonviewer.com/transaction/6ea7e695659b27a4b7b4acff4178fccf50c54ac8e6c8bd3059e055285c25361e) | [586c43f7](https://tonviewer.com/transaction/586c43f72025a72471157294a8858d938601ec16fcfd2464c1349de0ebe4681d) | [08df2450](https://tonviewer.com/transaction/08df2450dc8d20bebc28563e7298155e054b4d62e2e52aa121c60a9328b3c795) |


---

## How it works

1. **Deposit** — USDT from TON wallet or EVM chain (ETH · BNB · Base · Polygon) via Omniston bridge
2. **Swap** — Omniston RFQ, USDT → TON at best available rate
3. **Stake** — Tonstakers liquid staking, TON → tsTON
4. **LP** — [STON.fi](http://STON.fi) DEX v2, TON + tsTON pool (~5.4% APY)
5. **Withdraw** — USDT or full position to locked withdrawal address

---

## Features

**Mini App**

- Onboarding: TON wallet, EVM wallet, or manual deposit
- Dashboard: portfolio overview, LP position, cycle history
- Assets: all strategies and connected wallets
- Deposit: TON jetton or cross-chain bridge
- Settings: strategy config, withdrawal address, pause/resume

**Bot**

- `/start` `/status` `/settings` `/pause` `/resume` `/withdraw` `/help`
- Cycle notifications with tonviewer links
- Gas and deposit alerts

**AI — Mira MCP**

- 10 tools: `get_portfolio` · `run_now` · `withdraw` · `update_frequency` · `update_amount` · `pause_strategy` · `resume_strategy` · `create_strategy` · `set_withdrawal_address` · `get_history`
- Manifest: `/.well-known/mcp.json`

**Withdrawal destinations**

- TON → USD₮
- Ethereum → USD₮
- BNB Chain → USD₮
- Base → USDC
- Polygon → pUSD

---

## Security


|                    |                                                                     |
| ------------------ | ------------------------------------------------------------------- |
| Withdrawal address | Locked after first set; cannot be changed via bot or AI             |
| Wallet mnemonic    | Per-user AES-256-GCM (`authTagLength: 16`), encrypted in PostgreSQL |
| Auth               | Telegram `initData` HMAC-SHA256 on every API request                |
| Mira context       | One-time JWT, 5 min TTL, HTTP 410 on replay                         |
| EVM sessions       | Short-lived JWT, 30 min, in-memory                                  |
| Run now            | Max 3 cycles per call; blocked without withdrawal address           |


---

## Tech

Node.js · TypeScript · grammY · PostgreSQL · Railway  
Omniston SDK v1beta8 · [STON.fi](http://STON.fi) SDK v2 · Tonstakers · Telegram Mini App · Mira AI MCP

---

## Local dev

```bash
cp .env.example .env
npm install
npm run dev

```

Required: `BOT_TOKEN` · `DATABASE_URL` · `BACKEND_WALLET_MNEMONIC` · `MASTER_ENCRYPTION_KEY` · `TONCENTER_API_KEY`