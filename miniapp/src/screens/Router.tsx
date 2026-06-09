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
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setTarget("/onboarding");
    }, 5_000);

    getPortfolio()
      .then((p) => {
        const hasLegacy = p.plan != null;
        const hasMulti = (p.strategies?.length ?? 0) > 0;
        if (!cancelled) {
          setTarget(hasLegacy || hasMulti ? "/dashboard" : "/onboarding");
        }
      })
      .catch((e) => {
        if (e instanceof ApiError) {
          showToast(e.userMessage, "error");
        }
        if (!cancelled) setTarget("/onboarding");
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
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
