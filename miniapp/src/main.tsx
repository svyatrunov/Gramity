import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import "./app.css";

window.Telegram?.WebApp?.ready();
window.Telegram?.WebApp?.expand();
window.Telegram?.WebApp?.setBackgroundColor?.("#000000");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>
);
