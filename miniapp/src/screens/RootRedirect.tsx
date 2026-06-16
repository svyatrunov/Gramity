import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { fetchPortfolio } from "../api/portfolio";
import { ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { CardSkeleton } from "../components/Skeleton";
import { Page } from "../styles";

export function RootRedirect() {
  const { showToast } = useToast();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchPortfolio()
      .then((p) => {
        setTarget(p.plan == null ? "/onboarding" : "/dashboard");
      })
      .catch((e) => {
        if (e instanceof ApiError) {
          showToast(
            e.status === 401
              ? "Откройте приложение из Telegram-бота"
              : e.message,
            "error"
          );
        }
        setTarget("/onboarding");
      });
  }, [showToast]);

  if (!target) {
    return (
      <Page>
        <CardSkeleton />
      </Page>
    );
  }

  return <Navigate to={target} replace />;
}
