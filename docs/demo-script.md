# Demo video script

**Live:** [gramity-production.up.railway.app/app/onboarding.html](https://gramity-production.up.railway.app/app/onboarding.html)  
**Bot:** [@GramityBot](https://t.me/GramityBot)

---

## Before recording

- DCA wallet: **≥ $15 USDT** + **≥ 1 TON** gas
- Withdrawal address set (Tonkeeper / STON Wallet)
- Pre-fund wallet — do **not** wait live for MetaMask bridge (5–15 min); cut or time-lapse

---

## Scene 1 — Create strategy (2 min)

1. `/start` → **Open App**
2. Connect **TON wallet** (withdrawal address)
3. Connect **MetaMask** → bridge USDT *(or skip if pre-funded)*
4. Amount **$10**, frequency **weekly**
5. **Create Strategy** → bot confirms DCA wallet address

> Avoid **+ New Strategy** if a plan exists — it recreates the plan.

---

## Scene 2 — Run DCA now (1 min)

1. Open **Dashboard**
2. **⚡ Run DCA now** → **1 cycle**
3. Show Telegram message with **tonviewer** swap / stake / LP links

---

## Scene 3 — Change settings (1 min)

In bot:

```
/settings → ⏱ Change frequency → Every 2 weeks
/settings → 💰 Change amount → 15
```

Show `/status` — updated amount and next cycle time.

---

## Scene 4 — Pause & resume (30 sec)

1. Dashboard **Pause**
2. Dashboard **Resume**
3. `/status` — active again

---

## Scene 5 — Withdraw *(optional, 30 sec)*

Dashboard → **Withdraw USDT** or **Withdraw all**

---

## Commands (on screen at end)

```
/start      Open Mini App
/status     Portfolio
/settings   Amount, frequency, mode
/pause      Pause DCA
/resume     Resume DCA
/withdraw   Exit positions
/help       List commands
```

---

## Do not show on camera

- Demo / test / dev bot commands (removed)
- «Try demo mode» in onboarding (removed)
- Waiting 7 days for first scheduled weekly cycle — use **Run DCA now** instead
