import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOnboardingWallet } from "../../api/onboarding";
import { Step3Deposit } from "../Onboarding/Step3Deposit";
import { CardSkeleton } from "../../components/Skeleton";
import { Page, PageHeader } from "../../styles";

export function DepositScreenRoute() {
  const navigate = useNavigate();
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [amountUsdt, setAmountUsdt] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOnboardingWallet(false)
      .then((w) => {
        setDepositAddress(w.agent_wallet_address ?? w.deposit_address ?? "");
        setAmountUsdt(w.min_dca_usdt ?? 0);
      })
      .catch(() => {
        setDepositAddress("");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Page>
        <CardSkeleton />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Пополнение" subtitle="USDT на TON" />
      <Step3Deposit
        depositAddress={depositAddress ?? ""}
        amountUsdt={amountUsdt}
        showBack
        onBack={() => navigate("/dashboard")}
        onGoDashboard={() => navigate("/dashboard", { replace: true })}
      />
    </Page>
  );
}
