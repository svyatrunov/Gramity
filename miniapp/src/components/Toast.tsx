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
          bottom: 16,
          left: 16,
          right: 16,
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
  const bg =
    item.type === "success"
      ? "#e8f8ef"
      : item.type === "error"
        ? "#fde8e8"
        : "var(--tg-theme-secondary-bg-color, #f0f0f0)";
  const color =
    item.type === "success"
      ? "#1e7e34"
      : item.type === "error"
        ? "#c0392b"
        : "var(--tg-theme-text-color, #000)";

  return (
    <div
      style={{
        background: bg,
        color,
        padding: "12px 16px",
        borderRadius: 10,
        fontSize: 14,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        animation: item.type === "error" ? "shake 0.4s ease" : undefined,
      }}
    >
      {item.message}
    </div>
  );
}
