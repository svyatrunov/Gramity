import { connectNativeEthereum } from "./lib/evmWallet";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const statusEl = document.getElementById("status");
const rootEl = document.getElementById("root");
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;

function setStatus(html: string, className?: string) {
  if (!statusEl) return;
  statusEl.innerHTML = html;
  statusEl.className = className ?? "";
}

async function connectWallet() {
  if (!token) {
    setStatus("Invalid session. Open Gramity from Telegram and try again.", "err");
    return;
  }

  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = "Waiting for MetaMask…";
  }
  setStatus("Approve the connection in the MetaMask extension popup.");

  try {
    await fetch(`/api/evm-wallet/session?token=${encodeURIComponent(token)}`);
  } catch {
    /* non-fatal */
  }

  try {
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

    if (connectBtn) connectBtn.style.display = "none";
    if (rootEl) {
      rootEl.innerHTML =
        `<h1 class="ok">Connected</h1>` +
        `<p>Return to Telegram — your EVM balances will load automatically.</p>` +
        `<div class="addr">${conn.address}</div>`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Connection failed.<br><span class="err">${msg.slice(0, 200)}</span>`, "err");
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect MetaMask";
    }
  }
}

if (!token) {
  setStatus("Invalid session. Open Gramity from Telegram and try again.", "err");
} else {
  setStatus("Click the button below — MetaMask will ask you to approve the connection.");
}

connectBtn?.addEventListener("click", () => {
  void connectWallet();
});
