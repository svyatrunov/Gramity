import { connectNativeEthereum } from "./lib/evmWallet";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const statusEl = document.getElementById("status");
const rootEl = document.getElementById("root");

function setStatus(html: string, className?: string) {
  if (!statusEl) return;
  statusEl.innerHTML = html;
  statusEl.className = className ?? "";
}

async function main() {
  if (!token) {
    setStatus("Invalid session. Open Gramity from Telegram and try again.", "err");
    return;
  }

  try {
    await fetch(`/api/evm-wallet/session?token=${encodeURIComponent(token)}`);
  } catch {
    /* non-fatal */
  }

  try {
    setStatus("Approve connection in MetaMask…");
    const conn = await connectNativeEthereum();
    const res = await fetch("/api/evm-wallet/connected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        address: conn.address,
        chainId: conn.chainId,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    if (rootEl) {
      rootEl.innerHTML =
        `<h1 class="ok">Connected</h1>` +
        `<p>Return to Telegram — your EVM balances will load automatically.</p>` +
        `<div class="addr">${conn.address}</div>`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Connection failed.<br><span class="err">${msg.slice(0, 200)}</span>`, "err");
  }
}

void main();
