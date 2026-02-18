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

  // Apply display density to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-density", config.display_density);
  }, [config.display_density]);

  // Update language class on html element
  useEffect(() => {
    if (config.language?.startsWith("zh")) {
      document.documentElement.classList.add("lang-zh");
    } else {
      document.documentElement.classList.remove("lang-zh");
    }
  }, [config.language]);

  // Initial Data Load - Optimized for parallel execution
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const init = async () => {
      console.log("[init] Starting initialization...", {
        language: i18n.language,
        isInitialized: i18n.isInitialized,
      });

      // Wait for i18n to be ready to avoid showing raw keys
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

      // Check OS type first and apply class to HTML
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
      // Sequential fetch to ensure script state is ready for status check
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

      // Implement Auto-start Proxy
      const currentConfig = useSettingsStore.getState().config;
      const isRunning = useProxyStore.getState().running;
      if (currentConfig.auto_start_proxy && !isRunning) {
        console.log("[init] Auto-starting proxy...");
        await emit("init-status", t("init.status_proxy"));
        startProxy().catch((err) => console.error("Failed to auto-start proxy:", err));
      }

      console.log("[init] Initialization complete");
      await emit("init-status", t("init.status_complete"));

      // Show main window immediately when ready
      setTimeout(async () => {
        const mainWin = getCurrentWindow();

        // Parallelize fetching windows and showing main
        await mainWin.show();
        await mainWin.setFocus();

        // Find and close the splashscreen window
        const allWindows = await getAllWindows();
        const splashWin = allWindows.find((w) => w.label === "splashscreen");
        if (splashWin) {
          await splashWin.close();
        }
      }, 10);
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

  // Deferred Plugin Loading - Don't block initial render
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
      // Allow native context menu for inputs, textareas, and the CodeMirror editor
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
      const { running, checkStatus: checkProxyStatus } = useProxyStore.getState();
      if (running) {
        checkProxyStatus();
      }
    }, 5000);

    // Proactively re-check cert trust when window is refocused
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
