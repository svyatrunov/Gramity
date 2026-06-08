# MetaMask Connect — полный контекст проблемы

## Симптомы (Telegram Desktop, Windows)

1. При **Connect MetaMask** открываются **две вкладки** Chrome с `evm-wallet.html?token=…`
2. **Popup MetaMask extension не появляется** — будто кошелёк уже подключён
3. В Telegram сразу **Connected: 0x…** без балансов (или $0)
4. После `/reset` и `reset-user` — поведение то же (данные в PostgreSQL уже пустые для `155347765`)

---

## Архитектура (3 независимых слоя состояния)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. PostgreSQL (persistent)                                      │
│    plans, user_wallets, executions                              │
│    → /reset, deleteUserAccount()                                │
├─────────────────────────────────────────────────────────────────┤
│ 2. Server in-memory Map (ephemeral, per Railway instance)       │
│    evmWalletSession.ts → sessions Map                           │
│    evmDepositSession.ts → sessions Map                          │
│    → clearEvmWalletSessionsForTelegram(), replaceExistingSession│
├─────────────────────────────────────────────────────────────────┤
│ 3. Client-side (browser / TMA WebView)                          │
│    a) MetaMask site permission (chrome://extensions → Connected)│
│    b) MWP relay WebSocket (@metamask/connect-evm)               │
│       → может подставить window.ethereum в WebView              │
│    c) MWP eth_accounts cache (без popup если relay жив)         │
└─────────────────────────────────────────────────────────────────┘
```

`**/reset` не трогает:** MetaMask Connected Sites, MWP relay, кэш в Chrome.

---

## Call graph: onboarding → browser → server

```
User click [Connect MetaMask] or [MetaMask strip]
  │
  ├─ btnConnectMMStrip (onboarding.html:2772)
  │     goTo(WIZARD_STEP2) + runMetaMaskConnect(btnConnectMM)
  │
  └─ btnConnectMM click (onboarding.html:3057)
        runMetaMaskConnect(btn)
          │
          hasRealExtension = getExtensionProvider() && !isInsideTelegramMiniApp()
          │   ⚠️ BLIND SPOT: onboarding getExtensionProvider() НЕ проверяет TMA
          │   (TS-версия getBrowserExtensionProvider() проверяет — расхождение!)
          │
          ├─ hasRealExtension → connectViaExtension → eth_requestAccounts
          │     ⚠️ мгновенный Connected если window.ethereum = MWP relay
          │
          ├─ mobile → connectViaMetaMaskApp → [timeout] → connectViaMwp
          │     ⚠️ MWP connect() на desktop если UA содержит "Mobile"
          │
          └─ desktop → connectViaMetaMaskApp
                POST /api/evm-wallet/session  → createEvmWalletSession (status: pending)
                openMetaMaskUrl(pageUrl)      → ⚠️ см. цепочку открытия ниже
                pollEvmWalletSession(token)   → GET /api/evm-wallet/status каждые 2.5s
                      status=connected → handleMetaMaskAccounts → "Connected: 0x…"

Browser tab: evm-wallet.html?token=JWT
  evm-wallet-entry.tsx (после fix: кнопка Connect MetaMask)
    GET /api/evm-wallet/session?token=…  → status: opened
    [click Connect]
    connectNativeEthereum() → eth_requestAccounts (popup только если site не authorized)
    POST /api/evm-wallet/connected → status: connected, fetch balances async
```

---

## Call graph: открытие URL (источник двойной вкладки)

```
openMetaMaskUrl (onboarding.html:2796)
  → GramityMetaMask.openLink(url)           // = openMetaMaskLink
      → isPlainHttpUrl && !metamask host
          → openExternalBrowser(url)
              Desktop TMA:
                window.open(url, '_blank')  // ← ВЫЗОВ #1
                return
              ⚠️ Telegram Desktop WebView часто дублирует:
                 window.open → nativeOpen + tg.openLink → ВЫЗОВ #2

openMetaMaskUrl fallback (если SDK не загрузился):
  tg.openLink(url)                          // ещё один путь
  window.open(url, '_blank')

installTelegramOpenLinkPatch (metamaskConnect.ts:152)
  window.open = patched
  https URL → originalOpen()                // может снова триггерить TG bridge
  metamask:// → openMobileLink → tg.openLink
```

**Гипотеза двойной вкладки:** `window.open` на Telegram Desktop **сам** открывает Chrome **и** проксирует в `tg.openLink`.

**Гипотеза silent connect:**

- Poll получает `connected` с **другой вкладки** (первая из двух успела POST /connected)
- Или `connectViaMwp` / `connectViaExtension` через MWP `window.ethereum` в WebView
- Или MetaMask site уже authorized → `eth_requestAccounts` без popup

---

## Файлы и ответственность


| Файл                                    | Роль                                           | Риск                                               |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `miniapp/src/lib/metamaskConnect.ts`    | Единый SDK: open, MWP client, extension detect | window.open + patch                                |
| `miniapp/src/metamask-connect-entry.ts` | window.GramityMetaMask bridge                  | —                                                  |
| `miniapp/public/onboarding.html`        | runMetaMaskConnect, poll, openMetaMaskUrl      | **дублирует** логику TS, свой getExtensionProvider |
| `miniapp/src/evm-wallet-entry.tsx`      | Browser connect page                           | MetaMask site cache                                |
| `miniapp/src/screens/DepositScreen.tsx` | Cross-chain deposit TMA                        | openMetaMaskLink                                   |
| `src/services/evmWalletSession.ts`      | In-memory sessions                             | survives /reset in DB                              |
| `src/index.ts`                          | POST session, GET status, POST connected       | —                                                  |


---

## Известные fix (commits)


| Commit  | Что сделано                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| d7056b9 | pageUrl вместо link.metamask.io на desktop                                                                        |
| 31d2da8 | getBrowserExtensionProvider null in TMA; warm mobile-only; manual connect button; reset clears in-memory sessions |


## Fix v2 (pending deploy)

- `openGramityExternal.ts` — единая точка открытия: **только tg.openLink** в TMA + debounce 4s
- `connectMetaMaskWallet()` — **throws in TMA** (MWP полностью отключён в WebView)
- onboarding `getExtensionProvider()` — null в TMA (как TS)
- onboarding `openMetaMaskUrl` — без fallback tg.openLink + window.open
- POST `/api/evm-wallet/connected` — только status pending|opened

1. **Два open-path в onboarding** — `openMetaMaskUrl` vs TS `openExternalBrowser`, fallback `tg.openLink` + `window.open`
2. **window.open на Telegram Desktop** — вероятный duplicate с `tg.openLink`
3. **onboarding getExtensionProvider** — без TMA guard (расходится с TS)
4. **connectViaMwp fallback** — silent connect через MWP relay
5. **MWP client lazy init** — `installTelegramOpenLinkPatch` при первом connect(), не при open
6. **MetaMask Connected Sites** — не сбрасывается reset'ом
7. **Две вкладки = два GET /session?token** — обе могут POST /connected
8. **Railway multi-instance** — in-memory session на другом инстансе
9. **Кэш dist / CDN** — старый evm-wallet auto-connect bundle
10. **btnConnectMMStrip** — один клик, но `goTo` + `runMetaMaskConnect` — не двойной open, OK

---

## Как воспроизвести / отладить

```javascript
// В DevTools Telegram Desktop WebView (onboarding):
console.log({
  ua: navigator.userAgent,
  mobile: window.GramityMetaMask?.isMobileDevice?.(),
  inTma: window.GramityMetaMask?.isInsideTelegramMiniApp?.(),
  hasEthereum: !!window.ethereum,
  isMetaMask: window.ethereum?.isMetaMask,
  providers: window.ethereum?.providers?.length,
});
```

```bash
# Server logs при connect:
[EVM-WALLET] Session created user=155347765 id=...
[EVM-WALLET] Connected user=155347765 address=0x...
```

Если `Connected` в логах **до** клика Connect в Chrome → silent path (MWP или stale session).

---

## Целевое поведение (desktop TMA)

1. Один клик → **одна** вкладка `evm-wallet.html?token=…`
2. Страница ждёт клик **Connect MetaMask**
3. MetaMask popup (или disconnect site → popup снова)
4. POST /connected → poll в TMA → балансы

