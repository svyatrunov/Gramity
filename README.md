# Gramity — DCA Wallet on TON

> **STON.fi Vibe Coding Hackathon Cohort 2** · Omniston v1beta8  
> Live: [gramity-production.up.railway.app](https://gramity-production.up.railway.app) · Bot: [@GramityBot](https://t.me/GramityBot)

Automated DCA: deposit USDT from any chain → Omniston swap → Tonstakers → STON.fi LP. One setup, recurring cycles.

---

## How it works

1. **Deposit** USDT (MetaMask cross-chain or TON wallet)
2. **Omniston** — best-rate swap USDT → TON
3. **Tonstakers** — liquid stake → tsTON
4. **STON.fi DEX v2** — LP position (~5.4% APY)
5. **Withdrawal wallet** — locked at setup; funds exit here on withdraw

---

## User flow

| Step | Where |
|---|---|
| Setup | Mini App onboarding |
| Portfolio | Dashboard in Mini App |
| Run cycle now | Dashboard → **Run DCA now** |
| Change amount / frequency | Bot → `/settings` |
| Pause / resume | Dashboard or `/pause` `/resume` |
| Withdraw | Dashboard or `/withdraw` |

**Bot commands:** `/start` · `/status` · `/settings` · `/pause` · `/resume` · `/withdraw` · `/help`

**Video script:** [docs/demo-script.md](docs/demo-script.md)

---

## Security

| | |
|---|---|
| Withdrawal address | Locked after first set |
| DCA wallet | Per-user, AES-256-GCM encrypted mnemonic |
| Auth | Telegram initData HMAC |

---

## Tech

Node.js · grammY · PostgreSQL · Railway · Omniston SDK · STON.fi SDK v2 · Tonstakers · Telegram Mini App

---

## Local dev

```bash
cp .env.example .env
npm install
npm run dev
```
