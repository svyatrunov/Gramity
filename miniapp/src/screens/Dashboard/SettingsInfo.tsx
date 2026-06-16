import { BOT_USERNAME } from "../../config";
import { ActionButton } from "../../styles";

export function SettingsInfo() {
  const openBot = () => {
    window.Telegram?.WebApp?.openTelegramLink(`https://t.me/${BOT_USERNAME}`);
  };

  return (
    <section className="g-card g-section g-card--flat">
      <p className="g-hint" style={{ marginBottom: 12 }}>
        Чтобы изменить сумму, частоту или стратегию, отправьте /settings боту.
      </p>
      <ActionButton variant="secondary" onClick={openBot}>
        Открыть бота
      </ActionButton>
    </section>
  );
}
