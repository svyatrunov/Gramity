# Gramity — TON DCA Liquidity Provisioner
## Core Execution Engine v0.1 (Testnet)

> ⚠ **ФИНАНСОВЫЙ РИСК**: Этот код взаимодействует с реальными цифровыми активами.  
> Ошибки могут привести к безвозвратной потере средств.  
> Используйте только на TESTNET с небольшими суммами.

---

## Быстрый старт

```bash
# 1. Скопировать и заполнить .env
cp .env.example .env
# Заполни: BACKEND_WALLET_MNEMONIC, TONCENTER_API_KEY

# 2. Установить зависимости (уже выполнено)
npm install

# 3. Запустить (ts-node)
npm run dev

# ИЛИ собрать и запустить
npm run build
node dist/main.js
```

---

## 5-шаговая последовательность

```
INPUT: 50 USDT (testnet)

Step 1 — SWAP (Omniston v1beta8)
  USDT → TON
  • integrator fee: 10 bps (1000 pips)
  • WebSocket RFQ → quote → tonBuildSwap → sign & send
  • Track: swapTrack + balance polling
  LOG: TON amount received

Step 2 — CALCULATE SPLIT
  • Fetch tsTON/TON pool via STON.fi API
  • Formula: K = total / (tsTONRate × poolRatio + 1)
  LOG: stake_amount, keep_amount, current_ratio

Step 3 — STAKE (Tonstakers SDK)
  • BackendWalletConnector implements IWalletConnector
  • tonstakers.stake(stakeAmount)
  • Poll tsTON balance until arrival
  LOG: tsTON received, exchange rate

Step 4 — PROVIDE LIQUIDITY (STON.fi DEX SDK v2)
  API-driven: simulateLiquidityProvision → dexFactory → build TxParams
  Testnet fallback: hardcoded CPI Router v2.1.0 + pTON v2.1.0
  • Send TON leg + tsTON leg в одной транзакции (2 msg)
  LOG: LP tokens received, pool share %

Step 5 — VERIFY
  • getWalletPool → lpBalance, lpPriceUsd, apy1D/7D
  LOG: position value USD, APY
```

---

## Обязательные переменные .env

| Переменная | Описание |
|---|---|
| `BACKEND_WALLET_MNEMONIC` | 24 слова мнемоники кошелька |
| `TONCENTER_API_KEY` | API ключ от [toncenter.com](https://toncenter.com) |
| `OMNISTON_WS_URL` | `wss://omni-ws-sandbox.ston.fi` |
| `STON_API_URL` | `https://api.ston.fi` (mainnet для pool discovery) |
| `REFERRER_WALLET` | Адрес для получения integrator fee |
| `TSTON_ADDRESS` | Адрес tsTON jetton master на testnet (из Tonstakers SDK) |
| `TSTON_POOL_ADDRESS` | Адрес tsTON/TON пула (опционально) |

---

## Тестовые адреса (testnet)

| Контракт | Адрес |
|---|---|
| USDT testnet | `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` |
| Tonstakers staking | `kQANFsYyYn-GSZ4oajUJmboDURZU-udMHf9JxzO4vYM_hFP3` |
| CPI Router v2.1.0 | `kQALh-JBBIKK7gr0o4AVf9JZnEsFndqO0qTCyT-D-yBsWk0v` |
| pTON v2.1.0 | `kQACS30DNoUQ7NfApPvzh7eBmSZ9L4ygJ-lkNWtba8TQT-Px` |

### Как найти TSTON_ADDRESS

После первого запуска Step 3 SDK автоматически выведет в лог:
```
[INFO] tsTON address resolved: <address>
[INFO] Add to .env: TSTON_ADDRESS=<address>
```

Скопируй это значение в `.env` и перезапусти для шага 4.

---

## Пакеты

```
@ston-fi/omniston-sdk   — Omniston v1beta8 RFQ/swap
@ston-fi/sdk            — STON.fi DEX v2 LP provision
@ston-fi/api            — STON.fi REST API (pool/simulation)
tonstakers-sdk          — TON staking (tsTON)
@ton/ton                — TON blockchain client + wallet
@ton/crypto             — mnemonic → keypair
dotenv                  — .env loading
```

---

## Структура проекта

```
src/
├── config.ts          — env vars + constants
├── wallet.ts          — WalletContractV4 backend setup
├── step1-swap.ts      — Omniston USDT→TON swap
├── step2-split.ts     — pool ratio split calculator
├── step3-stake.ts     — Tonstakers TON→tsTON
├── step4-liquidity.ts — STON.fi LP provision
├── step5-verify.ts    — LP position verification
└── main.ts            — 5-step orchestrator
```
