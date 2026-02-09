import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import i18n from "../i18n";
import { Logger } from "../lib/logger";
import { startTrafficMonitor, stopTrafficMonitor } from "../lib/trafficMonitor";
import { useScriptStore } from "./scriptStore";

interface ProxyStore {
  running: boolean;
  port: number;
  ipAddress: string | null;
  requestCount: number;
  certTrusted: boolean;
  certWarningIgnored: boolean;
  error: string | null;
  activeScripts: string[]; // Scripts that were enabled when proxy started
  setRunning: (running: boolean) => void;
  incrementRequestCount: () => void;
  startProxy: () => Promise<void>;
  stopProxy: () => Promise<void>;
  checkStatus: () => Promise<void>;
  checkCertTrust: () => Promise<void>;
  setCertWarningIgnored: (ignored: boolean) => Promise<void>;
}

export const useProxyStore = create<ProxyStore>((set) => ({
  running: false,
  port: 9090,
  ipAddress: null,
  requestCount: 0,
  certTrusted: true, // Default to true to avoid flash
  certWarningIgnored: false,
  error: null,
  activeScripts: [],

  setRunning: (running) => set({ running }),

  incrementRequestCount: () =>
    set((state) => ({
      requestCount: state.requestCount + 1,
    })),

  startProxy: async () => {
    try {
      set({ error: null });

      // Check if already running to prevent double-start errors
      const status = await invoke<{
        running: boolean;
        active_scripts: string[];
      }>("get_proxy_status");
      if (status.running) {
        Logger.info("Proxy is already running, syncing state...");
        const config = await invoke<{ proxy_port: number }>("load_config");
        const ipAddress = await invoke<string>("get_local_ip");
        set({
          running: true,
          activeScripts: status.active_scripts,
          ipAddress,
          port: config.proxy_port,
        });
        return;
      }

      const result = await invoke<string>("start_proxy");
      Logger.debug("Proxy started:", result);

      // Load config to get the port
      const config = await invoke<{ proxy_port: number }>("load_config");

      // Capture currently enabled scripts as "active"
      const scripts = useScriptStore.getState().scripts;
      const activeScripts = scripts.filter((s) => s.enabled).map((s) => s.name);

      set({ running: true, port: config.proxy_port, activeScripts });

      // Wait a bit for mitmproxy to start, then connect Traffic Monitor with correct port
      setTimeout(() => {
        startTrafficMonitor(config.proxy_port);
      }, 2000);

      // 添加成功通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.start_success_title"),
        message: `${i18n.t("proxy_store.start_success_msg", { port: config.proxy_port })}${activeScripts.length > 0 ? i18n.t("proxy_store.scripts_loaded", { count: activeScripts.length }) : ""}`,
        type: "success",
        category: "system",
        priority: "normal",
        source: "Proxy Engine",
      });
    } catch (error) {
      const errorMsg = error as string;

      // Handle "Proxy is already running" error gracefully
      if (errorMsg.includes("Proxy is already running")) {
        Logger.info("Proxy is already running (caught error), syncing state...");
        try {
          const status = await invoke<{
            running: boolean;
            active_scripts: string[];
          }>("get_proxy_status");
          const config = await invoke<{ proxy_port: number }>("load_config");
          const ipAddress = await invoke<string>("get_local_ip");

          set({
            running: true,
            activeScripts: status.active_scripts,
            ipAddress,
            port: config.proxy_port,
            error: null, // Clear any error
          });

          // Don't show success notification for auto-recovery to avoid noise
          return;
        } catch (syncError) {
          console.error("Failed to sync state after running error:", syncError);
          // Fall through to error handling
        }
      }

      console.error("Failed to start proxy:", errorMsg);
      set({ error: errorMsg, running: false });

      // 添加错误通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.start_fail_title"),
        message: i18n.t("proxy_store.start_fail_msg", { error: errorMsg }),
        type: "error",
        category: "system",
        priority: "critical",
        source: "Proxy Engine",
      });

      throw error;
    }
  },

  stopProxy: async () => {
    try {
      set({ error: null });

      // Stop Traffic Monitor first
      stopTrafficMonitor();

      await invoke<string>("stop_proxy");
      set({ running: false, requestCount: 0 });

      // 添加成功通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.stop_success_title"),
        message: i18n.t("proxy_store.stop_success_msg"),
        type: "info",
        category: "system",
        priority: "normal",
        source: "Proxy Engine",
      });
    } catch (error) {
      const errorMsg = error as string;
      console.error("Failed to stop proxy:", errorMsg);
      set({ error: errorMsg });

      // 添加错误通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.stop_fail_title"),
        message: i18n.t("proxy_store.stop_fail_msg", { error: errorMsg }),
        type: "error",
        category: "system",
        priority: "high",
        source: "Proxy Engine",
      });

      throw error;
    }
  },

  checkStatus: async () => {
    try {
      const status = await invoke<{
        running: boolean;
        active_scripts: string[];
      }>("get_proxy_status");
      const currentState = useProxyStore.getState();

      // If status hasn't changed and we already have the basic info, skip expensive calls
      if (
        status.running === currentState.running &&
        currentState.ipAddress &&
        currentState.port !== 9090
      ) {
        // Just sync active scripts if they changed (rare)
        if (JSON.stringify(status.active_scripts) !== JSON.stringify(currentState.activeScripts)) {
          set({ activeScripts: status.active_scripts });
        }
        return;
      }

      // Status changed or info missing - do full update
      const ipAddress = await invoke<string>("get_local_ip");
      const config = await invoke<{
        proxy_port: number;
        cert_warning_ignored: boolean;
      }>("load_config");
      const isTrusted = await invoke<boolean>("check_cert_installed");

      set({
        running: status.running,
        activeScripts: status.active_scripts,
        ipAddress,
        port: config.proxy_port,
        certTrusted: isTrusted,
        certWarningIgnored: config.cert_warning_ignored,
      });
    } catch (error) {
      Logger.error("Failed to check proxy status:", error);
    }
  },

  checkCertTrust: async () => {
    try {
      const isTrusted = await invoke<boolean>("check_cert_installed");
      const config = await invoke<{ cert_warning_ignored: boolean }>("load_config");
      set({
        certTrusted: isTrusted,
        certWarningIgnored: config.cert_warning_ignored,
      });
    } catch (error) {
      Logger.error("Failed to check certificate trust:", error);
    }
  },

  setCertWarningIgnored: async (ignored: boolean) => {
    try {
      const config = await invoke<any>("load_config");
      config.cert_warning_ignored = ignored;
      await invoke("save_config", { config });
      set({ certWarningIgnored: ignored });
    } catch (error) {
      Logger.error("Failed to update cert warning ignore status:", error);
    }
  },
}));
