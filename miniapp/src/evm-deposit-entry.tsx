import React from "react";
import { createRoot } from "react-dom/client";
import { DepositScreen } from "./screens/DepositScreen";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DepositScreen authMode="token" sessionToken={token ?? undefined} />
  </React.StrictMode>
);
