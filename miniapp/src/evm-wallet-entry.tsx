import { connectNativeEthereum } from "./lib/evmWallet";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const statusEl = document.getElementById("status");
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement | null;

function setStatus(html: string, className?: string) {
  if (!statusEl) return;
  statusEl.innerHTML = html;
  statusEl.className = className ?? "";
}

function showConnectedAndClose(address: string) {
  document.body.innerHTML =
    '<div style="font-family:system-ui,sans-serif;background:#0d0d0f;color:#f1f1f3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">' +
    '<div style="max-width:420px;text-align:center">' +
    '<h1 style="color:#22c55e;font-size:20px;margin-bottom:8px">✅ Connected</h1>' +
    '<p style="color:#8b8b9e;font-size:14px;line-height:1.5;margin-bottom:12px">Return to Telegram — balances will appear automatically.</p>' +
    `<div style="font-family:monospace;font-size:13px;word-break:break-all;background:#22222a;border-radius:10px;padding:12px">${address}</div>` +
    '<p style="color:#8b8b9e;font-size:13px;margin-top:16px">You can close this tab.</p>' +
    "</div></div>";

  window.close();
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
    showConnectedAndClose(conn.address);
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
