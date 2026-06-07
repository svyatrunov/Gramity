import React, { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserProvider } from "ethers";
import type { Quote } from "@ston-fi/omniston-sdk";
import { api } from "../api";
import {
  CHAINS,
  CHAIN_LIST,
  TOKENS_BY_CHAIN,
  chainFromId,
  isSupportedChainId,
  type EvmChainKey,
  type TokenConfig,
} from "../lib/chains";
import {
  buildQuoteRequest,
  fetchQuote,
  formatOutputUsdt,
  getProtocolSpender,
} from "../lib/omnistonClient";
import {
  connectMetaMask,
  switchChain,
  readTokenBalance,
  readAllowance,
  approveToken,
  waitTx,
  estimateGasCost,
  registerCrossChainOrder,
  hasMetaMask,
  shortAddress,
  parseWalletError,
} from "../lib/evmWallet";

type Step = 1 | 2 | 3;
type TxStatus = "idle" | "pending" | "confirmed" | "failed";

const S: Record<string, React.CSSProperties> = {
  root: { padding: 16, maxWidth: 480, margin: "0 auto" },
  stepBar: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
  },
  stepDotActive: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: "var(--tg-theme-link-color, #2481cc)",
  },
  stepDotIdle: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: "var(--tg-theme-hint-color, #ddd)",
    opacity: 0.35,
  },
  card: {
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  label: { fontSize: 12, color: "var(--tg-theme-hint-color, #888)", marginBottom: 6 },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: 15,
    marginBottom: 10,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "var(--tg-theme-bg-color, #fff)",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: 15,
    marginBottom: 10,
  },
  btn: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginTop: 8,
  },
  btnDisabled: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: "var(--tg-theme-hint-color, #aaa)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "not-allowed",
    marginTop: 8,
  },
  warn: {
    background: "#fff3cd",
    color: "#856404",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  error: {
    background: "#fde8e8",
    color: "#c0392b",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  success: {
    background: "#e8f8ef",
    color: "#1e7e34",
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  mono: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    wordBreak: "break-all" as const,
  },
  dest: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--tg-theme-bg-color, #fff)",
    border: "1px dashed var(--tg-theme-hint-color, #ccc)",
    cursor: "pointer",
  },
};

export function DepositScreen() {
  const [step, setStep] = useState<Step>(1);
  const [configErr, setConfigErr] = useState("");
  const [botWallet, setBotWallet] = useState("");
  const [omnistonWs, setOmnistonWs] = useState("");
  const [tonUsdt, setTonUsdt] = useState("");

  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectErr, setConnectErr] = useState("");

  const [chainKey, setChainKey] = useState<EvmChainKey>("ethereum");
  const [token, setToken] = useState<TokenConfig>(TOKENS_BY_CHAIN.ethereum[0]);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteErr, setQuoteErr] = useState("");
  const [gasInfo, setGasInfo] = useState<string>("");

  const [approveStatus, setApproveStatus] = useState<TxStatus>("idle");
  const [sendStatus, setSendStatus] = useState<TxStatus>("idle");
  const [approveHash, setApproveHash] = useState("");
  const [sendHash, setSendHash] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [allowanceOk, setAllowanceOk] = useState(false);

  const quoteDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    api
      .depositConfig()
      .then((c) => {
        setBotWallet(c.botWalletAddress);
        setOmnistonWs(c.omnistonWsUrl);
        setTonUsdt(c.tonUsdtAddress);
      })
      .catch((e: Error) => setConfigErr(e.message));
  }, []);

  useEffect(() => {
    const tokens = TOKENS_BY_CHAIN[chainKey];
    setToken(tokens[0]);
    setQuote(null);
    setQuoteErr("");
  }, [chainKey]);

  useEffect(() => {
    if (!provider || !walletAddress || !token) return;
    readTokenBalance(provider, token, walletAddress)
      .then(setTokenBalance)
      .catch(() => setTokenBalance("—"));
  }, [provider, walletAddress, token, chainKey]);

  useEffect(() => {
    if (!amount || !omnistonWs || !tonUsdt || !botWallet || parseFloat(amount) <= 0) {
      setQuote(null);
      setQuoteErr("");
      setGasInfo("");
      return;
    }

    if (quoteDebounce.current) clearTimeout(quoteDebounce.current);
    quoteDebounce.current = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteErr("");
      try {
        const req = buildQuoteRequest(chainKey, token, amount, tonUsdt, botWallet);
        const q = await fetchQuote(omnistonWs, req);
        setQuote(q);
        if (provider) {
          const gas = await estimateGasCost(provider, q);
          setGasInfo(
            gas
              ? `~${gas.gasCostNative} ${gas.nativeSymbol} (${gas.gasUnits} gas units)`
              : q.gasBudget
                ? `Gas budget: ${q.gasBudget}`
                : ""
          );
        }
      } catch (e: unknown) {
        setQuote(null);
        setQuoteErr(parseWalletError(e));
      } finally {
        setQuoteLoading(false);
      }
    }, 600);

    return () => {
      if (quoteDebounce.current) clearTimeout(quoteDebounce.current);
    };
  }, [amount, chainKey, token, omnistonWs, tonUsdt, botWallet, provider]);

  useEffect(() => {
    async function checkAllowance() {
      if (!provider || !walletAddress || !quote) {
        setAllowanceOk(false);
        return;
      }
      const spender = getProtocolSpender(quote);
      if (!spender) {
        setAllowanceOk(false);
        return;
      }
      try {
        const needed = BigInt(quote.inputUnits);
        const current = await readAllowance(provider, token, walletAddress, spender);
        setAllowanceOk(current >= needed);
      } catch {
        setAllowanceOk(false);
      }
    }
    checkAllowance();
  }, [provider, walletAddress, quote, token, approveStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectErr("");
    try {
      if (!hasMetaMask()) {
        throw new Error("MetaMask не установлен");
      }
      const conn = await connectMetaMask();
      setProvider(conn.provider);
      setWalletAddress(conn.address);
      setWalletChainId(conn.chainId);
      setStep(2);
    } catch (e: unknown) {
      setConnectErr(parseWalletError(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleSwitchNetwork = async () => {
    setConnectErr("");
    try {
      await switchChain(CHAINS[chainKey]);
      if (provider) {
        const network = await provider.getNetwork();
        setWalletChainId(Number(network.chainId));
      }
    } catch (e: unknown) {
      setConnectErr(parseWalletError(e));
    }
  };

  const copyDestination = useCallback(() => {
    if (!botWallet) return;
    navigator.clipboard.writeText(botWallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [botWallet]);

  const handleApprove = async () => {
    if (!provider || !quote) return;
    const spender = getProtocolSpender(quote);
    if (!spender) {
      setActionErr("Не удалось определить контракт для approve");
      return;
    }

    setActionErr("");
    setApproveStatus("pending");
    try {
      const chain = CHAINS[chainKey];
      if (walletChainId !== chain.chainId) {
        await switchChain(chain);
        setWalletChainId(chain.chainId);
      }
      const signer = await provider.getSigner();
      const hash = await approveToken(signer, token, spender);
      setApproveHash(hash);
      await waitTx(provider, hash);
      setApproveStatus("confirmed");
    } catch (e: unknown) {
      setApproveStatus("failed");
      setActionErr(parseWalletError(e));
    }
  };

  const handleSend = async () => {
    if (!provider || !quote || !botWallet || !omnistonWs) return;

    setActionErr("");
    setSendStatus("pending");
    try {
      const chain = CHAINS[chainKey];
      if (walletChainId !== chain.chainId) {
        await switchChain(chain);
        setWalletChainId(chain.chainId);
      }
      const signer = await provider.getSigner();
      await registerCrossChainOrder(
        omnistonWs,
        quote,
        chainKey,
        walletAddress,
        botWallet,
        signer
      );

      const pseudoHash = `order-${quote.quoteId.slice(0, 16)}`;
      setSendHash(pseudoHash);
      setSendStatus("confirmed");

      await api.depositInitiated({
        txHash: pseudoHash,
        amount: parseFloat(amount),
        sourceChain: chain.label,
        sourceToken: token.symbol,
      });
    } catch (e: unknown) {
      setSendStatus("failed");
      setActionErr(parseWalletError(e));
    }
  };

  const currentChain = walletChainId != null ? chainFromId(walletChainId) : undefined;
  const networkMismatch =
    walletChainId != null && walletChainId !== CHAINS[chainKey].chainId;
  const unsupportedNetwork =
    walletChainId != null && !isSupportedChainId(walletChainId);

  if (configErr) {
    return (
      <div style={S.root}>
        <div style={S.error}>⚠️ {configErr}</div>
      </div>
    );
  }

  if (!botWallet) {
    return <div style={S.root}>Загрузка конфигурации…</div>;
  }

  return (
    <div style={S.root}>
      <h2 style={{ marginBottom: 4, fontSize: 20 }}>Cross-chain депозит</h2>
      <p style={{ fontSize: 13, color: "var(--tg-theme-hint-color,#888)", marginBottom: 16 }}>
        Пополнение USDT на TON через MetaMask
      </p>

      <div style={S.stepBar}>
        {([1, 2, 3] as Step[]).map((n) => (
          <div
            key={n}
            style={step > n || step === n ? S.stepDotActive : S.stepDotIdle}
          />
        ))}
      </div>

      {/* ── Step 1: Connect ── */}
      {step >= 1 && (
        <div style={S.card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>
            {step > 1 ? "✅" : "1."} Подключить кошелёк
          </div>

          {!walletAddress ? (
            <>
              <button
                style={connecting ? S.btnDisabled : S.btn}
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? "Подключение…" : "Connect MetaMask"}
              </button>
              {connectErr && <div style={{ ...S.error, marginTop: 10 }}>{connectErr}</div>}
            </>
          ) : (
            <div style={S.mono}>
              <div>{shortAddress(walletAddress)}</div>
              {currentChain && (
                <div style={{ color: "var(--tg-theme-hint-color,#888)", marginTop: 4 }}>
                  Сеть: {currentChain.label}
                  {tokenBalance && ` · Баланс ${token.symbol}: ${tokenBalance}`}
                </div>
              )}
              {unsupportedNetwork && (
                <div style={{ ...S.warn, marginTop: 8 }}>
                  ⚠️ Сеть не поддерживается. Выберите Ethereum, Base, BNB или Polygon.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Configure ── */}
      {step >= 2 && walletAddress && (
        <div style={S.card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>2. Настроить перевод</div>

          <div style={S.label}>Сеть источника</div>
          <select
            style={S.select}
            value={chainKey}
            onChange={(e) => {
              setChainKey(e.target.value as EvmChainKey);
              setStep(2);
            }}
          >
            {CHAIN_LIST.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>

          {networkMismatch && (
            <div style={S.warn}>
              ⚠️ MetaMask на другой сети.{" "}
              <button
                type="button"
                onClick={handleSwitchNetwork}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--tg-theme-link-color,#2481cc)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                  fontSize: 13,
                }}
              >
                Переключить на {CHAINS[chainKey].label}
              </button>
            </div>
          )}

          <div style={S.label}>Токен</div>
          <select
            style={S.select}
            value={token.address}
            onChange={(e) => {
              const t = TOKENS_BY_CHAIN[chainKey].find((x) => x.address === e.target.value);
              if (t) setToken(t);
            }}
          >
            {TOKENS_BY_CHAIN[chainKey].map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol}
              </option>
            ))}
          </select>

          <div style={S.label}>Сумма</div>
          <input
            style={S.input}
            type="number"
            min="0"
            step="any"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {quoteLoading && (
            <div style={{ fontSize: 13, color: "var(--tg-theme-hint-color,#888)" }}>
              Получаю котировку…
            </div>
          )}
          {quoteErr && <div style={S.error}>{quoteErr}</div>}
          {quote && !quoteLoading && (
            <div style={{ fontSize: 14, marginBottom: 8 }}>
              <strong>Вы получите ≈ {formatOutputUsdt(quote)} USDT</strong> на TON
              {gasInfo && (
                <div style={{ fontSize: 12, color: "var(--tg-theme-hint-color,#888)", marginTop: 4 }}>
                  Gas estimate: {gasInfo}
                </div>
              )}
            </div>
          )}

          <div style={S.label}>Адрес назначения (TON)</div>
          <div style={S.dest} onClick={copyDestination} title="Нажмите чтобы скопировать">
            <span style={S.mono}>{botWallet}</span>
            <span style={{ fontSize: 12, color: "var(--tg-theme-link-color,#2481cc)" }}>
              {copied ? "✓" : "Copy"}
            </span>
          </div>

          {amount && quote && (
            <button style={S.btn} onClick={() => setStep(3)}>
              Продолжить →
            </button>
          )}
        </div>
      )}

      {/* ── Step 3: Execute ── */}
      {step >= 3 && quote && (
        <div style={S.card}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>3. Подтвердить</div>

          <p style={{ fontSize: 13, marginBottom: 12 }}>
            Отправка {amount} {token.symbol} → ≈{formatOutputUsdt(quote)} USDT на TON
          </p>

          {!allowanceOk && (
            <>
              <button
                style={approveStatus === "pending" ? S.btnDisabled : S.btn}
                onClick={handleApprove}
                disabled={approveStatus === "pending"}
              >
                {approveStatus === "pending"
                  ? "Approve…"
                  : approveStatus === "confirmed"
                    ? "✅ Approved"
                    : "Approve"}
              </button>
              {approveStatus === "pending" && (
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--tg-theme-hint-color,#888)" }}>
                  Статус: pending…
                </div>
              )}
              {approveStatus === "confirmed" && approveHash && (
                <div style={{ ...S.success, marginTop: 8 }}>
                  Approve confirmed:{" "}
                  <a
                    href={CHAINS[chainKey].explorerTx + approveHash}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "inherit" }}
                  >
                    {shortAddress(approveHash)}
                  </a>
                </div>
              )}
            </>
          )}

          {(allowanceOk || approveStatus === "confirmed") && (
            <>
              <button
                style={sendStatus === "pending" ? S.btnDisabled : S.btn}
                onClick={handleSend}
                disabled={sendStatus === "pending"}
              >
                {sendStatus === "pending"
                  ? "Отправка…"
                  : sendStatus === "confirmed"
                    ? "✅ Отправлено"
                    : "Send"}
              </button>
              {sendStatus === "pending" && (
                <div style={{ fontSize: 12, marginTop: 6, color: "var(--tg-theme-hint-color,#888)" }}>
                  Статус: pending…
                </div>
              )}
              {sendStatus === "confirmed" && (
                <div style={{ ...S.success, marginTop: 8 }}>
                  Ордер зарегистрирован. ID: {sendHash}
                  <div style={{ marginTop: 6, fontSize: 12 }}>
                    Бот уведомлён — средства поступят после исполнения маршрута.
                  </div>
                </div>
              )}
            </>
          )}

          {sendStatus === "failed" && <div style={S.error}>Send failed</div>}
          {actionErr && <div style={{ ...S.error, marginTop: 8 }}>{actionErr}</div>}
        </div>
      )}
    </div>
  );
}
