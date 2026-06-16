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
import { Page, PageHeader, Spinner } from "../../styles";
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
    <Page>
      <PageHeader
        title="Портфель"
        subtitle="DCA-стратегия на TON"
        action={
          <Link to="/deposit" className="g-link">
            Пополнить
          </Link>
        }
      />

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
        className="g-fab"
        onClick={() => void openMira()}
        disabled={miraLoading}
      >
        {miraLoading ? <Spinner size={14} /> : "Спросить Mira"}
      </button>
    </Page>
  );
}
