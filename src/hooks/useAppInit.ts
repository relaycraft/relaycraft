import { emit } from "@tauri-apps/api/event";
import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { type } from "@tauri-apps/plugin-os";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { initPlugins } from "../plugins/pluginLoader";
import { useAIStore } from "../stores/aiStore";
import { usePluginStore } from "../stores/pluginStore";
import { useProxyStore } from "../stores/proxyStore";
import { useRuleStore } from "../stores/ruleStore";
import { useScriptStore } from "../stores/scriptStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useThemeStore } from "../stores/themeStore";
import { useUIStore } from "../stores/uiStore";

interface UseAppInitProps {
  setShowExitModal: (show: boolean) => void;
}

export function useAppInit({ setShowExitModal }: UseAppInitProps) {
  const config = useSettingsStore((state) => state.config);
  const loadConfig = useSettingsStore((state) => state.loadConfig);
  const loadAISettings = useAIStore((state) => state.loadSettings);
  const loadRules = useRuleStore((state) => state.loadRules);
  const fetchScripts = useScriptStore((state) => state.fetchScripts);
  const checkStatus = useProxyStore((state) => state.checkStatus);
  const startProxy = useProxyStore((state) => state.startProxy);
  const checkCertTrust = useProxyStore((state) => state.checkCertTrust);
  const { t, i18n } = useTranslation();

  const initRef = useRef(false);

  // Apply display density
  useEffect(() => {
    document.documentElement.setAttribute("data-density", config.display_density);
  }, [config.display_density]);

  // Update language class
  useEffect(() => {
    if (config.language?.startsWith("zh")) {
      document.documentElement.classList.add("lang-zh");
    } else {
      document.documentElement.classList.remove("lang-zh");
    }
  }, [config.language]);

  // Initial Data Load
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      // Record start time to guarantee splash display duration
      const initStart = Date.now();
      const MIN_SPLASH_MS = 500;

      console.log("[init] Starting initialization...", {
        language: i18n.language,
        isInitialized: i18n.isInitialized,
      });

      // Wait for i18n to avoid raw keys
      if (!i18n.isInitialized) {
        console.log("[init] i18n not initialized, waiting...");
        await new Promise((resolve) => {
          const check = () => {
            if (i18n.isInitialized) resolve(true);
            else setTimeout(check, 50);
          };
          check();
        });
        console.log("[init] i18n initialized now", { language: i18n.language });
        console.log("[init] i18n initialized now", { language: i18n.language });
      }

      // Critical path - must complete first
      const osStatus = t("init.status_os");
      console.log("[init] OS Status string:", osStatus);
      await emit("init-status", osStatus);

      // Apply OS class
      try {
        const osType = await type();
        if (osType === "macos") {
          document.documentElement.classList.add("platform-mac");
          useUIStore.getState().setOsType(true);
        }
      } catch (_e) {
        // Fallback
        const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
        if (isMac) {
          document.documentElement.classList.add("platform-mac");
        }
        useUIStore.getState().setOsType(isMac);
      }

      console.log("[init] Loading config...");
      await emit("init-status", t("init.status_config"));
      // Apply language class
      const currentLang = useSettingsStore.getState().config.language || "en";
      console.log("[init] Current persistent language:", currentLang);

      if (currentLang.startsWith("zh")) {
        document.documentElement.classList.add("lang-zh");
      } else {
        document.documentElement.classList.remove("lang-zh");
      }

      await loadConfig();

      console.log("[init] Loading data stores...");
      await emit("init-status", t("init.status_data"));
      // Ensure script state is ready
      await fetchScripts();

      // Parallel non-dependent operations
      await Promise.all([
        loadAISettings(),
        loadRules(),
        checkStatus(),
        checkCertTrust(),
        useThemeStore.getState().fetchThemes(),
        usePluginStore.getState().fetchPlugins(),
      ]);

      // Check if traffic monitoring should start
      const currentConfig = useSettingsStore.getState().config;
      const { running: isEngineRunning, active: isTrafficActive } = useProxyStore.getState();
      if (currentConfig.auto_start_proxy && isEngineRunning && !isTrafficActive) {
        console.log("[init] Auto-starting traffic monitoring...");
        await emit("init-status", t("init.status_proxy"));
        startProxy().catch((err) => console.error("Failed to auto-start traffic monitoring:", err));
      }

      console.log("[init] Initialization complete");
      await emit("init-status", t("init.status_complete"));

      // Show Window (Wait for MIN_SPLASH_MS)
      const elapsed = Date.now() - initStart;
      const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
      setTimeout(async () => {
        const mainWin = getCurrentWindow();

        // Show main Window
        await mainWin.show();
        await mainWin.setFocus();

        // Close splashscreen
        const allWindows = await getAllWindows();
        const splashWin = allWindows.find((w) => w.label === "splashscreen");
        if (splashWin) {
          await splashWin.close();
        }
      }, remaining);
    };
    init();
  }, [
    checkCertTrust,
    checkStatus,
    fetchScripts,
    loadAISettings,
    loadConfig,
    loadRules,
    startProxy,
    t,
    i18n.language,
    i18n.isInitialized,
  ]);

  // Deferred Plugin Loading
  useEffect(() => {
    const timer = setTimeout(() => {
      initPlugins();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle Close Interception
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
      const currentConfig = useSettingsStore.getState().config;
      if (currentConfig.confirm_exit) {
        event.preventDefault();
        setShowExitModal(true);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [setShowExitModal]);

  // Disable default context menu globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Allow native context menu for inputs and editors
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.closest(".cm-editor")
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Proxy Status Heartbeat
  useEffect(() => {
    const heartbeat = setInterval(() => {
      const { checkStatus: checkProxyStatus } = useProxyStore.getState();
      checkProxyStatus();
    }, 5000);

    // Re-check cert trust on focus
    const handleFocus = () => {
      checkCertTrust();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(heartbeat);
    };
  }, [checkCertTrust]);
}
