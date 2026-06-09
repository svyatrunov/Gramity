import { useNavigate } from "react-router-dom";
import { ActionButton, S } from "../../styles";

export function SettingsDrawer({
  open,
  onClose,
  depositAddress,
}: {
  open: boolean;
  onClose: () => void;
  depositAddress?: string;
}) {
  const navigate = useNavigate();

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--tg-theme-bg-color, #fff)",
          borderRadius: "16px 16px 0 0",
          padding: 20,
          width: "100%",
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Настройки</h2>

        <div style={S.warn}>
          Чтобы изменить сумму, частоту или стратегию — используйте /settings в Telegram-боте.
        </div>

        {depositAddress && (
          <div style={{ marginBottom: 16 }}>
            <div style={S.label}>Адрес для пополнения</div>
            <div
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                wordBreak: "break-all",
                marginBottom: 8,
              }}
            >
              {depositAddress}
            </div>
            <ActionButton
              variant="secondary"
              onClick={() => {
                onClose();
                navigate(`/deposit?wallet=${encodeURIComponent(depositAddress)}`);
              }}
            >
              Пополнить →
            </ActionButton>
          </div>
        )}

        <ActionButton variant="secondary" onClick={onClose}>
          Закрыть
        </ActionButton>
      </div>
    </div>
  );
}
