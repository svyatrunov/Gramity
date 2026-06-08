import React from "react";
import { createRoot } from "react-dom/client";
import { DepositScreen } from "./screens/DepositScreen";
import { CHAINS, type EvmChainKey } from "./lib/chains";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const chainParam = params.get("chain");
const amountParam = params.get("amount");

const initialChain =
  chainParam && chainParam in CHAINS ? (chainParam as EvmChainKey) : undefined;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DepositScreen
      authMode="token"
      sessionToken={token ?? undefined}
      initialChain={initialChain}
      initialAmount={amountParam ?? undefined}
    />
  </React.StrictMode>
);
