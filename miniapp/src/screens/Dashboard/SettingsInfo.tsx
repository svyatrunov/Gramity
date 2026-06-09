import { BOT_USERNAME } from "../../config";
import { ActionButton, S } from "../../styles";

export function SettingsInfo() {
  const openBot = () => {
    window.Telegram?.WebApp?.openTelegramLink(`https://t.me/${BOT_USERNAME}`);
  };

  return (
    <div style={S.card}>
      <p style={{ fontSize: 14, marginBottom: 12, lineHeight: 1.4 }}>
        Чтобы изменить сумму, частоту или стратегию — отправьте /settings боту
      </p>
      <ActionButton variant="secondary" onClick={openBot}>
        Открыть бота
      </ActionButton>
    </div>
  );
}
