import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { Logger } from "./lib/logger";

if (typeof window !== 'undefined') {
  (window as any).React = React;
}

// Synchronously apply cached theme colors to prevent flash
try {
  const cachedColors = localStorage.getItem('themeColors');
  if (cachedColors) {
    const colors = JSON.parse(cachedColors);
    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value as string);
    });
  }
} catch (e) {
  Logger.error('Failed to apply cached theme colors', e);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
