import React, { useEffect, useState } from "react";
import { api, type WalletInfo } from "../api";

const S: Record<string, React.CSSProperties> = {
  root: { padding: 16 },
  card: {
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  alias: { fontWeight: 600, marginBottom: 4 },
  addr: { fontSize: 11, color: "var(--tg-theme-hint-color, #888)", wordBreak: "break-all" },
  balance: { marginTop: 6, fontWeight: 600 },
  btn: {
    marginTop: 16,
    width: "100%",
    padding: "12px 0",
    borderRadius: 10,
    border: "none",
    background: "var(--tg-theme-button-color, #2481cc)",
    color: "var(--tg-theme-button-text-color, #fff)",
    fontSize: 15,
    cursor: "pointer",
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--tg-theme-hint-color, #ccc)",
    background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
    color: "var(--tg-theme-text-color, #000)",
    fontSize: 15,
    marginBottom: 8,
  },
};

export function WalletsScreen() {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [alias, setAlias] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api.wallets().then(setWallets).catch((e: Error) => setErr(e.message));

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!alias.trim()) return;
    setCreating(true);
    try {
      await api.createWallet(alias.trim());
      setAlias("");
      await load();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={S.root}>
      <h3 style={{ marginBottom: 12 }}>Мои кошельки</h3>
      {err && <div style={{ color: "red", marginBottom: 8 }}>{err}</div>}

      {wallets.map((w) => (
        <div key={w.wallet_address} style={S.card}>
          <div style={S.alias}>{w.alias}</div>
          <div style={S.addr}>{w.wallet_address}</div>
          <div style={S.balance}>USDT: ${w.usdtBalance.toFixed(2)}</div>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Создать новый кошелёк</div>
        <input
          style={S.input}
          placeholder="Название (например: DCA #2)"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <button style={S.btn} onClick={create} disabled={creating}>
          {creating ? "Создаю..." : "Создать агент-кошелёк"}
        </button>
      </div>
    </div>
  );
}
