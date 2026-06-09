import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getPortfolio } from "../api/portfolio";
import { ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { CardSkeleton } from "../components/Skeleton";
import { S } from "../styles";

export function Router() {
  const { showToast } = useToast();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    getPortfolio()
      .then((p) => {
        setTarget(p.plan == null ? "/onboarding" : "/dashboard");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code !== "SERVER_ERROR") {
          showToast(e.userMessage, "error");
        } else if (e instanceof ApiError) {
          showToast(e.userMessage, "error");
        }
        setTarget("/onboarding");
      });
  }, [showToast]);

  if (!target) {
    return (
      <div style={S.root}>
        <CardSkeleton />
      </div>
    );
  }

  return <Navigate to={target} replace />;
}
