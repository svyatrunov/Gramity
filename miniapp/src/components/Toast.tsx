import React, { createContext, useCallback, useContext, useState } from "react";

export type ToastType = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: "max(16px, env(safe-area-inset-bottom, 0px))",
          left: "max(16px, env(safe-area-inset-left, 0px))",
          right: "max(16px, env(safe-area-inset-right, 0px))",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} item={t} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function Toast({ item }: { item: ToastItem }) {
  const className =
    item.type === "success"
      ? "g-alert g-alert--success"
      : item.type === "error"
        ? "g-alert g-alert--error"
        : "g-alert";

  return (
    <div
      className={className}
      style={{
        boxShadow: "var(--g-shadow)",
        pointerEvents: "auto",
        animation: item.type === "error" ? "shake 0.4s ease" : undefined,
      }}
    >
      {item.message}
    </div>
  );
}
