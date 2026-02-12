import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";
import { type } from "@tauri-apps/plugin-os";
import { useEffect } from "react";
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
  const { config, loadConfig } = useSettingsStore();
  const { loadSettings: loadAISettings } = useAIStore();
  const { loadRules } = useRuleStore();
  const { fetchScripts } = useScriptStore();
  const { checkStatus, startProxy, checkCertTrust } = useProxyStore();

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
    const init = async () => {
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

      // Apply language class
      const currentLang = useSettingsStore.getState().config.language || "en";
      if (currentLang.startsWith("zh")) {
        document.documentElement.classList.add("lang-zh");
      } else {
        document.documentElement.classList.remove("lang-zh");
      }

      // Critical path - must complete first
      await loadConfig();

      // Parallel non-dependent operations (50-70% faster than sequential)
      await Promise.all([
        loadAISettings(),
        loadRules(),
        fetchScripts(),
        checkStatus(),
        checkCertTrust(),
        useThemeStore.getState().fetchThemes(),
        usePluginStore.getState().fetchPlugins(),
      ]);

      // Implement Auto-start Proxy
      const currentConfig = useSettingsStore.getState().config;
      const isRunning = useProxyStore.getState().running;
      if (currentConfig.auto_start_proxy && !isRunning) {
        startProxy().catch((err) => console.error("Failed to auto-start proxy:", err));
      }

      // Show window after initialization is complete to avoid white screen
      setTimeout(async () => {
        const mainWin = getCurrentWindow();
        await mainWin.show();

        // Find and close the splashscreen window
        const allWindows = await getAllWindows();
        const splashWin = allWindows.find((w) => w.label === "splashscreen");
        if (splashWin) {
          await splashWin.close();
        }
      }, 2000);
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
      if (useProxyStore.getState().running) {
        checkStatus();
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
  }, [checkStatus, checkCertTrust]);
}
