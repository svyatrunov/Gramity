import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { ConnectWallet } from "./ConnectWallet";
import { DepositScreen } from "./screens/DepositScreen";
import { LegacyTabApp } from "./LegacyTabApp";
import { Router } from "./screens/Router";
import { OnboardingScreen } from "./screens/Onboarding";
import { DashboardScreen } from "./screens/Dashboard";
import { DepositScreenRoute } from "./screens/Deposit";
import { MANIFEST_URL } from "./config";

function LegacyModes() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");

  if (mode === "connect") {
    return (
      <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
        <ConnectWallet />
      </TonConnectUIProvider>
    );
  }

  if (mode === "deposit") {
    return <DepositScreen />;
  }

  return null;
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");

  if (mode === "connect" || mode === "deposit") {
    return <LegacyModes />;
  }

  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route path="/" element={<Router />} />
        <Route path="/onboarding" element={<OnboardingScreen />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
        <Route path="/deposit" element={<DepositScreenRoute />} />
        <Route path="/legacy" element={<LegacyTabApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
