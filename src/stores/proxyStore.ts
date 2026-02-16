import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import i18n from "../i18n";
import { Logger } from "../lib/logger";
import { finalPollAndStop, startTrafficMonitor, stopTrafficMonitor } from "../lib/trafficMonitor";
import { useScriptStore } from "./scriptStore";

interface ProxyStore {
  running: boolean; // Engine process is running
  active: boolean; // Traffic processing is active
  port: number;
  ipAddress: string | null;
  requestCount: number;
  certTrusted: boolean;
  certWarningIgnored: boolean;
  error: string | null;
  activeScripts: string[]; // Scripts that were enabled when proxy started
  setRunning: (running: boolean) => void;
  incrementRequestCount: () => void;
  startProxy: () => Promise<void>; // Now sets active=true
  stopProxy: () => Promise<void>; // Now sets active=false
  checkStatus: () => Promise<void>;
  checkCertTrust: () => Promise<void>;
  setCertWarningIgnored: (ignored: boolean) => Promise<void>;
}

export const useProxyStore = create<ProxyStore>((set) => ({
  running: false,
  active: false,
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

      // Get current status
      const status = await invoke<{
        running: boolean;
        active: boolean;
        active_scripts: string[];
      }>("get_proxy_status");

      // If engine is not running, something is wrong (it should auto-start with app)
      if (!status.running) {
        Logger.warn("Proxy engine not running, this should not happen with auto-start");
        set({ running: false, active: false });
        return;
      }

      // Load config to get the port
      const config = await invoke<{ proxy_port: number }>("load_config");

      // Start Traffic Monitor first (creates session before traffic starts)
      await startTrafficMonitor(config.proxy_port);

      // Set traffic processing to active AFTER session is created
      await invoke("set_proxy_active", { active: true });

      // Capture currently enabled scripts as "active"
      const scripts = useScriptStore.getState().scripts;
      const activeScripts = scripts.filter((s) => s.enabled).map((s) => s.name);

      set({ running: true, active: true, port: config.proxy_port, activeScripts });

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
      console.error("Failed to start proxy:", errorMsg);
      set({ error: errorMsg, active: false });

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

      // Set traffic processing to inactive first (stops accepting new requests)
      await invoke("set_proxy_active", { active: false });

      // Final poll to capture any remaining data, then stop monitor
      await finalPollAndStop();

      set({ active: false, requestCount: 0 });

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
        active: boolean;
        active_scripts: string[];
      }>("get_proxy_status");
      const currentState = useProxyStore.getState();

      // If status hasn't changed and we already have the basic info, skip expensive calls
      if (
        status.running === currentState.running &&
        status.active === currentState.active &&
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
        active: status.active,
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
