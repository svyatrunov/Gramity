import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createMiraContext } from "../../api/mira";
import { ApiError } from "../../api/client";
import { usePortfolio } from "../../hooks/usePortfolio";
import { useToast } from "../../components/Toast";
import { PortfolioBlock } from "./PortfolioBlock";
import { StrategyCard } from "./StrategyCard";
import { ActionsBar } from "./ActionsBar";
import { ExecutionsList } from "./ExecutionsList";
import { SettingsInfo } from "./SettingsInfo";
import { S } from "../../styles";
import type { PortfolioResponse } from "../../api/portfolio";

export function DashboardScreen() {
  const { data, loading, error, refresh } = usePortfolio(true);
  const { showToast } = useToast();
  const [localData, setLocalData] = useState<PortfolioResponse | null>(null);
  const [miraLoading, setMiraLoading] = useState(false);

  useEffect(() => {
    if (data) setLocalData(data);
  }, [data]);

  useEffect(() => {
    if (error) {
      showToast(error.userMessage, "error");
    }
  }, [error, showToast]);

  const displayData = localData ?? data;

  const handleOptimisticActive = (active: boolean) => {
    setLocalData((prev) => {
      if (!prev?.plan) return prev;
      return { ...prev, plan: { ...prev.plan, active } };
    });
  };

  const openMira = async () => {
    setMiraLoading(true);
    try {
      const res = await createMiraContext("dashboard");
      if (res.mira_deeplink) {
        window.Telegram?.WebApp?.openTelegramLink(res.mira_deeplink);
      } else {
        showToast("Mira недоступна", "error");
      }
    } catch (e) {
      showToast(
        e instanceof ApiError ? e.userMessage : "Что-то пошло не так",
        "error"
      );
    } finally {
      setMiraLoading(false);
    }
  };

  return (
    <div style={S.root}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h1 style={{ fontSize: 20 }}>Dashboard</h1>
        <Link
          to="/deposit"
          style={{
            fontSize: 14,
            color: "var(--tg-theme-link-color, #2481cc)",
            textDecoration: "none",
          }}
        >
          Пополнить →
        </Link>
      </div>

      <PortfolioBlock data={displayData} loading={loading} />
      <StrategyCard data={displayData} loading={loading} />
      <ActionsBar
        data={displayData}
        onRefresh={() => void refresh()}
        onOptimisticActive={handleOptimisticActive}
      />
      <ExecutionsList executions={displayData?.executions} />
      <SettingsInfo />

      <button
        type="button"
        onClick={() => void openMira()}
        disabled={miraLoading}
        style={{
          position: "fixed",
          bottom: 20,
          right: 16,
          border: "none",
          borderRadius: 999,
          padding: "12px 16px",
          background: "var(--tg-theme-button-color, #2481cc)",
          color: "var(--tg-theme-button-text-color, #fff)",
          fontSize: 14,
          fontWeight: 600,
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          cursor: "pointer",
          zIndex: 50,
        }}
      >
        {miraLoading ? "…" : "🤖 Ask Mira"}
      </button>
    </div>
  );
}
