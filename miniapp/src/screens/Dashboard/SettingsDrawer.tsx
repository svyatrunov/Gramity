import { useNavigate } from "react-router-dom";
import { ActionButton } from "../../styles";

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
    <div className="g-sheet-backdrop" onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="g-sheet-title">Настройки</h2>

        <div className="g-alert g-alert--warn">
          Чтобы изменить сумму, частоту или стратегию, используйте /settings в Telegram-боте.
        </div>

        {depositAddress && (
          <div style={{ marginBottom: 16 }}>
            <div className="g-label">Адрес для пополнения</div>
            <div className="g-mono-box">{depositAddress}</div>
            <ActionButton
              variant="secondary"
              onClick={() => {
                onClose();
                navigate(`/deposit?wallet=${encodeURIComponent(depositAddress)}`);
              }}
            >
              Пополнить
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
