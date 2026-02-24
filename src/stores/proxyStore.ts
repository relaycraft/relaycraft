import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import i18n from "../i18n";
import { Logger } from "../lib/logger";
import { finalPollAndStop, startTrafficMonitor, stopTrafficMonitor } from "../lib/trafficMonitor";
import { useScriptStore } from "./scriptStore";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  recoveryAttempts: number; // Internal counter for auto-recovery
  isRecovering: boolean; // Flag to prevent multiple recovery attempts
  setRunning: (running: boolean) => void;
  incrementRequestCount: () => void;
  startProxy: () => Promise<void>; // Now sets active=true
  stopProxy: () => Promise<void>; // Now sets active=false
  restartProxy: () => Promise<void>; // Restart engine to reload scripts
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
  recoveryAttempts: 0,
  isRecovering: false,

  setRunning: (running) => set({ running }),

  incrementRequestCount: () =>
    set((state) => ({
      requestCount: state.requestCount + 1,
    })),

  startProxy: async () => {
    try {
      set({ error: null, recoveryAttempts: 0 }); // Reset on manual startup

      // Start the "timer" for minimum delay
      const minDelay = sleep(500);

      // Get current status
      const status = await invoke<{
        running: boolean;
        active: boolean;
        active_scripts: string[];
      }>("get_proxy_status");

      // Engine should auto-start with the app
      if (!status.running) {
        Logger.warn("Proxy engine not running, this should not happen with auto-start");
        set({ running: false, active: false });
        // Let user retry manually
        return;
      }

      // Load config to get the port
      const config = await invoke<{ proxy_port: number }>("load_config");

      // Start Traffic Monitor first (creates session before traffic starts)
      await startTrafficMonitor(config.proxy_port);

      // Activate traffic AFTER session is created
      await invoke("set_proxy_active", { active: true });

      // Snapshot enabled scripts as active
      const scripts = useScriptStore.getState().scripts;
      const activeScriptNames = scripts.filter((s) => s.enabled).map((s) => s.name);

      // Ensure at least 500ms has passed
      await minDelay;

      set({
        running: true,
        active: true,
        port: config.proxy_port,
        activeScripts: activeScriptNames,
      });

      // 添加成功通知
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.start_success_title"),
        message: `${i18n.t("proxy_store.start_success_msg", { port: config.proxy_port })}${activeScriptNames.length > 0 ? i18n.t("proxy_store.scripts_loaded", { count: activeScriptNames.length }) : ""}`,
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

      // Start the "timer" for minimum delay
      const minDelay = sleep(500);

      // Set inactive first, then drain remaining data
      await invoke("set_proxy_active", { active: false });

      // Final poll to capture any remaining data, then stop monitor
      await finalPollAndStop();

      // Ensure at least 500ms has passed
      await minDelay;

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

  restartProxy: async () => {
    try {
      set({ error: null, recoveryAttempts: 0 }); // Reset on manual restart

      // Stop traffic monitor first
      await stopTrafficMonitor();

      // Restart the engine (stop + start, which reloads scripts)
      await invoke("restart_proxy");

      // Load config to get the port
      const config = await invoke<{ proxy_port: number }>("load_config");

      // Start Traffic Monitor again
      await startTrafficMonitor(config.proxy_port);

      // Activate traffic AFTER session is created
      await invoke("set_proxy_active", { active: true });

      // Snapshot enabled scripts as active
      const scripts = useScriptStore.getState().scripts;
      const activeScriptNames = scripts.filter((s) => s.enabled).map((s) => s.name);

      set({
        running: true,
        active: true,
        port: config.proxy_port,
        activeScripts: activeScriptNames,
      });

      // Clear modified since start flag
      useScriptStore.getState().clearModifiedSinceStart();

      // Add success notification
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.restart_success_title"),
        message: `${i18n.t("proxy_store.restart_success_msg", { port: config.proxy_port })}${activeScriptNames.length > 0 ? i18n.t("proxy_store.scripts_loaded", { count: activeScriptNames.length }) : ""}`,
        type: "success",
        category: "system",
        priority: "normal",
        source: "Proxy Engine",
      });
    } catch (error) {
      const errorMsg = error as string;
      console.error("Failed to restart proxy:", errorMsg);
      set({ error: errorMsg, active: false });

      // Add error notification
      const { useNotificationStore } = await import("./notificationStore");
      useNotificationStore.getState().addNotification({
        title: i18n.t("proxy_store.restart_fail_title"),
        message: i18n.t("proxy_store.restart_fail_msg", { error: errorMsg }),
        type: "error",
        category: "system",
        priority: "critical",
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

      // Unexpected engine crash detection & auto-recovery
      if (!(status.running || currentState.isRecovering) && currentState.recoveryAttempts < 3) {
        Logger.warn(
          `Proxy engine crash detected (Attempts: ${currentState.recoveryAttempts + 1}/3). Triggering auto-recovery...`,
        );

        set({ isRecovering: true });

        // Small delay to avoid rapid-fire restarts
        setTimeout(async () => {
          try {
            await useProxyStore.getState().restartProxy();
            set({ isRecovering: false, recoveryAttempts: 0 }); // Reset on success
            Logger.info("Proxy engine auto-recovery successful.");
          } catch (err) {
            set((state) => ({
              isRecovering: false,
              recoveryAttempts: state.recoveryAttempts + 1,
            }));
            Logger.error(
              `Proxy engine auto-recovery attempt ${currentState.recoveryAttempts + 1} failed: ${err}`,
            );
          }
        }, 1000);
      }

      // Skip if nothing changed and we have basic info
      if (
        status.running === currentState.running &&
        status.active === currentState.active &&
        currentState.ipAddress &&
        currentState.port > 0
      ) {
        return;
      }

      // Status changed - do full update
      const ipAddress = await invoke<string>("get_local_ip");
      const config = await invoke<{
        proxy_port: number;
        cert_warning_ignored: boolean;
      }>("load_config");
      const isTrusted = await invoke<boolean>("check_cert_installed");

      // Determine active scripts
      let activeScriptNames = currentState.activeScripts;

      if (!status.running) {
        activeScriptNames = [];
      } else if (status.active) {
        activeScriptNames = status.active_scripts || [];
      } else {
        if (activeScriptNames.length === 0) {
          const scripts = useScriptStore.getState().scripts;
          if (scripts.length > 0) {
            activeScriptNames = scripts.filter((s) => s.enabled).map((s) => s.name);
          }
        }
      }

      set({
        running: status.running,
        active: status.active,
        activeScripts: activeScriptNames,
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
