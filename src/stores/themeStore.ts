import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Logger } from "../lib/logger";
import { useSettingsStore } from "./settingsStore";
import { processColorForVibrancy } from "./themeStore/vibrancy";
import { useUIStore } from "./uiStore";

// Debounce timer for set_window_vibrancy IPC calls.
// Prevents rapid-fire DWM recomposition when applyVibrancy() is called
// multiple times during startup or theme switching.
let _vibrancyTimer: ReturnType<typeof setTimeout> | null = null;

export interface Theme {
  id: string;
  name: string;
  type: "light" | "dark";
  colors: Record<string, string>;
  css?: string;
  path?: string;
  pluginId: string;
}

export type ThemeMode = "light" | "dark" | "system" | "custom";

interface ThemeStore {
  themes: Theme[];
  activeThemeId: string;
  themeMode: ThemeMode;
  registerTheme: (theme: Omit<Theme, "pluginId">, pluginId: string) => void;
  unregisterPluginThemes: (pluginId: string) => void;
  setTheme: (themeId: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  getThemeType: () => "light" | "dark";
  initSystemThemeListener: () => () => void;
  fetchThemes: () => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  applyVibrancy: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  themes: [
    {
      id: "default",
      name: "Modern Charcoal",
      type: "dark",
      colors: {
        /* ═══════════════════════════════════════════════════════════════
         * CORE SURFACE COLORS (Backgrounds)
         * These use rgba with transparency for vibrancy/glass effect.
         * When vibrancy is disabled, these are blended with solid background.
         * ═══════════════════════════════════════════════════════════════ */
        // Vibrancy-aware surface colors.
        // RGB values carry a subtle cool-blue bias matching the primary color (#60a5fa),
        // so when the OS blur bleeds through, the tint feels intentional rather than accidental.
        // Alpha values are slightly lower than before to let the OS effect breathe;
        // when vibrancy is disabled, blendRgbaWithBackground() composites these onto
        // the solid dark background — the result is visually indistinguishable from the old values.
        "--color-background": "rgba(13, 15, 22, 0.35)", // Main app background
        "--color-muted": "rgba(16, 18, 27, 0.40)", // Secondary surfaces, sidebars
        "--color-card": "rgba(20, 23, 34, 0.72)", // Cards, panels, detail views
        "--color-popover": "rgba(20, 24, 34, 0.78)", // Dropdowns, tooltips, modals
        "--color-input": "rgba(12, 14, 22, 0.58)", // Input fields, text boxes
        "--color-secondary": "rgba(12, 15, 24, 0.47)", // Secondary buttons, badges
        "--color-accent": "rgba(26, 30, 42, 0.58)", // Accent surfaces, highlights

        /* ═══════════════════════════════════════════════════════════════
         * TEXT COLORS (Solid - no transparency)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-foreground": "#e6edf3", // Primary text
        "--color-muted-foreground": "#8b949e", // Secondary text, placeholders
        "--color-popover-foreground": "#ffffff", // Text on popovers
        "--color-card-foreground": "#e6edf3", // Text on cards
        "--color-primary-foreground": "#ffffff", // Text on primary buttons
        "--color-secondary-foreground": "#8b949e", // Text on secondary elements
        "--color-accent-foreground": "#ffffff", // Text on accent surfaces
        "--color-destructive-foreground": "#ffffff", // Text on destructive actions
        "--color-success-foreground": "#ffffff", // Text on success states
        "--color-warning-foreground": "#000000", // Text on warnings (dark for contrast)
        "--color-info-foreground": "#ffffff", // Text on info states

        /* ═══════════════════════════════════════════════════════════════
         * BORDER COLORS (Semi-transparent)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-border": "rgba(255, 255, 255, 0.08)", // Standard borders
        "--color-border-subtle": "rgba(255, 255, 255, 0.04)", // Subtle dividers
        "--color-border-muted": "rgba(255, 255, 255, 0.12)", // Emphasized borders

        /* ═══════════════════════════════════════════════════════════════
         * SEMANTIC COLORS (Solid - for accessibility)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-primary": "#60a5fa", // Primary actions, links, focus
        "--color-destructive": "#fb7185", // Errors, delete actions
        "--color-success": "#10b981", // Success states, confirmations
        "--color-warning": "#f59e0b", // Warnings, cautions
        "--color-info": "#3b82f6", // Informational elements
        "--color-ring": "#3b82f6", // Focus ring color

        /* Rule Type Specific Colors - Dark */
        "--color-rule-script": "#818cf8",
        "--color-rule-rewrite-body": "#a855f7",
        "--color-rule-map-local": "#3b82f6",
        "--color-rule-map-remote": "#10b981",
        "--color-rule-rewrite-header": "#f97316",
        "--color-rule-throttle": "#06b6d4",
        "--color-rule-block": "#f43f5e",

        /* Method Colors - Dark */
        "--color-method-get": "#3b82f6",
        "--color-method-post": "#10b981",
        "--color-method-put": "#f59e0b",
        "--color-method-delete": "#f43f5e",

        /* Semantic Syntax Palette - Dark (One Dark Inspired) */
        "--syntax-keyword": "#c678dd",
        "--syntax-string": "#98c379",
        "--syntax-comment": "#8b949e",
        "--syntax-constant": "#d19a66",
        "--syntax-function": "#61afef",
        "--syntax-variable": "#e06c75",
        "--syntax-property": "#e06c75",
        "--syntax-operator": "#56b6c2",
        "--syntax-gutter": "rgba(255, 255, 255, 0.1)",

        /* Surface & Glass Effects */
        "--surface-opacity-subtle": "0.1",
        "--surface-opacity-glass": "0.4",
        "--surface-opacity-solid": "0.95",
        "--blur-sm": "4px",
        "--blur-md": "12px",
        "--blur-lg": "40px",

        /* Typography Scale */
        "--text-micro": "0.625rem",
        "--text-tiny": "0.6875rem",
        "--text-caption": "0.75rem",
        "--text-small": "0.8125rem",
        "--text-ui": "0.8125rem",
      },
      pluginId: "system",
    },
    {
      id: "light",
      name: "Nebula White",
      type: "light",
      colors: {
        /* ═══════════════════════════════════════════════════════════════
         * CORE SURFACE COLORS (Backgrounds) - Light Theme
         * Light theme needs lower opacity for visible vibrancy effect.
         * ═══════════════════════════════════════════════════════════════ */
        "--color-background": "rgba(252, 252, 253, 0.65)", // Main app background
        "--color-muted": "rgba(244, 244, 247, 0.55)", // Secondary surfaces, sidebars
        "--color-card": "rgba(255, 255, 255, 0.75)", // Cards, panels, detail views
        "--color-popover": "rgba(255, 255, 255, 0.85)", // Dropdowns, tooltips, modals
        "--color-input": "rgba(255, 255, 255, 0.8)", // Input fields, text boxes
        "--color-secondary": "rgba(244, 244, 247, 0.5)", // Secondary buttons, badges
        "--color-accent": "rgba(238, 242, 255, 0.6)", // Accent surfaces, highlights

        /* ═══════════════════════════════════════════════════════════════
         * TEXT COLORS (Solid - no transparency)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-foreground": "#1a1c23", // Primary text
        "--color-muted-foreground": "#6b7280", // Secondary text, placeholders
        "--color-popover-foreground": "#1a1c23", // Text on popovers
        "--color-card-foreground": "#1a1c23", // Text on cards
        "--color-primary-foreground": "#ffffff", // Text on primary buttons
        "--color-secondary-foreground": "#4f46e5", // Text on secondary elements
        "--color-accent-foreground": "#4f46e5", // Text on accent surfaces
        "--color-destructive-foreground": "#ffffff", // Text on destructive actions
        "--color-success-foreground": "#ffffff", // Text on success states
        "--color-warning-foreground": "#ffffff", // Text on warnings
        "--color-info-foreground": "#ffffff", // Text on info states

        /* ═══════════════════════════════════════════════════════════════
         * BORDER COLORS (Semi-transparent)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-border": "rgba(0, 0, 0, 0.08)", // Standard borders
        "--color-border-subtle": "rgba(0, 0, 0, 0.04)", // Subtle dividers
        "--color-border-muted": "rgba(0, 0, 0, 0.1)", // Emphasized borders

        /* ═══════════════════════════════════════════════════════════════
         * SEMANTIC COLORS (Solid - for accessibility)
         * ═══════════════════════════════════════════════════════════════ */
        "--color-primary": "#4f46e5", // Primary actions, links, focus
        "--color-destructive": "#ef4444", // Errors, delete actions
        "--color-success": "#10b981", // Success states, confirmations
        "--color-warning": "#f59e0b", // Warnings, cautions
        "--color-info": "#3b82f6", // Informational elements
        "--color-ring": "#4f46e5", // Focus ring color

        /* Rule Type Specific Colors - Light */
        "--color-rule-script": "#4f46e5",
        "--color-rule-rewrite-body": "#7c3aed",
        "--color-rule-map-local": "#2563eb",
        "--color-rule-map-remote": "#059669",
        "--color-rule-rewrite-header": "#ea580c",
        "--color-rule-throttle": "#0891b2",
        "--color-rule-block": "#e11d48",

        /* Method Colors - Light */
        "--color-method-get": "#2563eb",
        "--color-method-post": "#059669",
        "--color-method-put": "#d97706",
        "--color-method-delete": "#dc2626",

        /* Semantic Syntax Palette - Light (GitHub Light Inspired) */
        "--syntax-keyword": "#d73a49",
        "--syntax-string": "#032f62",
        "--syntax-comment": "#6a737d",
        "--syntax-constant": "#005cc5",
        "--syntax-function": "#6f42c1",
        "--syntax-variable": "#24292e",
        "--syntax-property": "#005cc5",
        "--syntax-operator": "#d73a49",
        "--syntax-gutter": "rgba(0, 0, 0, 0.1)",

        /* Surface & Glass Effects */
        "--surface-opacity-subtle": "0.05",
        "--surface-opacity-glass": "0.6",
        "--surface-opacity-solid": "0.98",
        "--blur-sm": "4px",
        "--blur-md": "12px",
        "--blur-lg": "40px",

        /* Typography Scale */
        "--text-micro": "0.625rem",
        "--text-tiny": "0.6875rem",
        "--text-caption": "0.75rem",
        "--text-small": "0.8125rem",
        "--text-ui": "0.8125rem",
      },
      pluginId: "system",
    },
  ] as Theme[],
  activeThemeId: localStorage.getItem("activeThemeId") || "default",
  themeMode: (localStorage.getItem("themeMode") as ThemeMode) || "dark",

  fetchThemes: async () => {
    try {
      const discovered = await invoke<any[]>("get_themes");
      set((state) => {
        const builtIn = state.themes.filter((t) => t.pluginId === "system");
        const custom = discovered.map((t: any) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          colors: t.colors,
          css: t.css,
          path: t.path,
          pluginId: "local-theme",
        }));
        return { themes: [...builtIn, ...custom] };
      });

      // Re-apply theme after fetching (to load CSS/assets for custom themes)
      const state = get();
      if (state.themeMode === "custom") {
        get().setTheme(state.activeThemeId);
      } else {
        get().setThemeMode(state.themeMode);
      }
    } catch (error) {
      Logger.error("[ThemeStore] Failed to fetch themes:", error);
    }
  },

  deleteTheme: async (id: string) => {
    try {
      Logger.debug(`[ThemeStore] Deleting theme ${id}...`);
      await invoke("uninstall_theme", { id });

      // Should switching to default if deleting current active?
      const state = get();
      if (state.activeThemeId === id) {
        get().setThemeMode("system"); // Or default
      }

      await get().fetchThemes();
    } catch (error) {
      Logger.error("[ThemeStore] Failed to delete theme:", error);
      throw error;
    }
  },

  registerTheme: (theme, pluginId) => {
    set((state) => {
      if (state.themes.some((t) => t.id === theme.id)) return state;
      return { themes: [...state.themes, { ...theme, pluginId }] };
    });
  },

  unregisterPluginThemes: (pluginId) => {
    set((state) => {
      const remainingThemes = state.themes.filter((t) => t.pluginId !== pluginId);

      // Check if active theme is being removed
      let newActive = state.activeThemeId;
      const activeTheme = state.themes.find((t) => t.id === state.activeThemeId);

      if (activeTheme?.pluginId === pluginId) {
        newActive = "default";
        // Revert to default: Remove all custom properties set by the theme
        const root = document.documentElement;
        Object.keys(activeTheme.colors).forEach((key) => {
          root.style.removeProperty(key);
        });
        // Remove custom CSS
        const styleTag = document.getElementById("relaycraft-theme-custom-css");
        if (styleTag) styleTag.remove();

        Logger.debug(
          `[ThemeStore] Reverted to default theme (active theme ${activeTheme.id} unloaded)`,
        );
      }
      return { themes: remainingThemes, activeThemeId: newActive };
    });
  },

  applyVibrancy: () => {
    const { getThemeType, activeThemeId, themes } = get();
    const vibrancyEnabled = useSettingsStore.getState().config.enable_vibrancy;
    const isDarkTheme = getThemeType() === "dark";
    const isMac = useUIStore.getState().isMac;

    Logger.debug(
      `[ThemeStore] applyVibrancy -> enabled: ${vibrancyEnabled}, isDark: ${isDarkTheme}`,
    );

    // Re-apply current theme colors with vibrancy processing
    // This blends rgba() colors with appropriate background when vibrancy is disabled
    const activeTheme = themes.find((t) => t.id === activeThemeId);
    if (activeTheme) {
      const root = document.documentElement;
      Object.entries(activeTheme.colors).forEach(([key, value]) => {
        const processedValue = processColorForVibrancy(key, value, {
          vibrancyEnabled,
          isDarkTheme,
          isMac,
        });
        root.style.setProperty(key, processedValue);
      });
    }

    // Mark the document so CSS can conditionally adjust glass/blur rules.
    // This is the single source of truth for vibrancy state in CSS-land.
    document.documentElement.dataset.vibrancy = vibrancyEnabled ? "on" : "off";

    // When vibrancy is active, glass surfaces need crisper border definition —
    // the OS blur makes content behind panels visible, so edges matter more.
    // We override border vars here (after the theme color loop) so this applies
    // to both built-in and custom themes without touching theme files.
    if (activeTheme) {
      const root = document.documentElement;
      if (vibrancyEnabled) {
        if (isDarkTheme) {
          root.style.setProperty("--color-border", "rgba(255, 255, 255, 0.12)");
          root.style.setProperty("--color-border-subtle", "rgba(255, 255, 255, 0.06)");
          root.style.setProperty("--color-border-muted", "rgba(255, 255, 255, 0.20)");
        } else {
          root.style.setProperty("--color-border", "rgba(0, 0, 0, 0.10)");
          root.style.setProperty("--color-border-subtle", "rgba(0, 0, 0, 0.05)");
          root.style.setProperty("--color-border-muted", "rgba(0, 0, 0, 0.15)");
        }
      } else {
        // Restore theme-defined border values
        const borderVars = ["--color-border", "--color-border-subtle", "--color-border-muted"];
        borderVars.forEach((v) => {
          const themeValue = activeTheme.colors[v];
          if (themeValue) root.style.setProperty(v, themeValue);
        });
      }
    }

    // Send effect to Rust backend (debounced).
    // The Rust side also deduplicates by tracking current effect state,
    // but debouncing here avoids even the IPC overhead on rapid calls.
    const effect = vibrancyEnabled ? getThemeType() : "none";
    if (_vibrancyTimer) clearTimeout(_vibrancyTimer);
    _vibrancyTimer = setTimeout(() => {
      invoke("set_window_vibrancy", { effect }).catch((err) => {
        Logger.error("[ThemeStore] Failed to set window vibrancy:", err);
      });
    }, 150);
  },

  setTheme: async (themeId) => {
    const theme = get().themes.find((t) => t.id === themeId);
    if (theme) {
      set({ activeThemeId: themeId, themeMode: "custom" });
      localStorage.setItem("activeThemeId", themeId);
      localStorage.setItem("themeMode", "custom");
      // Cache colors for anti-flash on reboot
      localStorage.setItem("themeColors", JSON.stringify(theme.colors));

      // Check vibrancy setting and theme type to process colors accordingly
      const vibrancyEnabled = useSettingsStore.getState().config.enable_vibrancy;
      const isDarkTheme = theme.type === "dark";
      const isMac = useUIStore.getState().isMac;

      // Apply Variables (blend rgba with background if vibrancy disabled)
      const root = document.documentElement;
      Object.entries(theme.colors).forEach(([key, value]) => {
        const processedValue = processColorForVibrancy(key, value, {
          vibrancyEnabled,
          isDarkTheme,
          isMac,
        });
        root.style.setProperty(key, processedValue);
      });

      // Apply Custom CSS
      const styleId = "relaycraft-theme-custom-css";
      let styleTag = document.getElementById(styleId);

      if (theme.css) {
        try {
          Logger.debug(`[ThemeStore] Loading custom CSS for ${themeId}...`);

          if (theme.pluginId !== "system") {
            const cssContent = await invoke<string>("read_theme_file", {
              themeId: theme.id,
              fileName: theme.css,
            });

            // Process asset URLs
            let processedCss = cssContent;
            if (theme.path) {
              processedCss = cssContent.replace(
                /url\(['"]?(assets\/[^'"]+)['"]?\)/g,
                (_match, assetPath) => {
                  const normalizedThemePath = theme.path?.replace(/\\/g, "/");
                  const fullPath = `${normalizedThemePath}/${assetPath}`;
                  const assetUrl = convertFileSrc(fullPath);
                  Logger.debug("[ThemeStore] Resolved asset:", {
                    assetPath,
                    assetUrl,
                  });
                  return `url('${assetUrl}')`;
                },
              );
            }

            if (!styleTag) {
              styleTag = document.createElement("style");
              styleTag.id = styleId;
              document.head.appendChild(styleTag);
            }
            styleTag.textContent = processedCss;
            Logger.debug(`[ThemeStore] Custom CSS applied with assets.`);
          }
        } catch (error) {
          Logger.error("[ThemeStore] Failed to load custom theme CSS:", error);
        }
      } else {
        if (styleTag) styleTag.remove();
      }
      get().applyVibrancy(); // Call applyVibrancy after theme is set
    }
  },

  setThemeMode: (mode) => {
    set({ themeMode: mode });
    localStorage.setItem("themeMode", mode);

    if (mode === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      get().setTheme(isDark ? "default" : "light");
      set({ themeMode: "system" });
      localStorage.setItem("themeMode", "system");
    } else if (mode === "light") {
      get().setTheme("light");
      set({ themeMode: "light" });
      localStorage.setItem("themeMode", "light");
    } else if (mode === "dark") {
      get().setTheme("default");
      set({ themeMode: "dark" });
      localStorage.setItem("themeMode", "dark");
    } else if (mode === "custom") {
      const state = get();
      const activeTheme = state.themes.find((t) => t.id === state.activeThemeId);
      if (!activeTheme || activeTheme.pluginId === "system") {
        const firstCustom = state.themes.find((t) => t.pluginId !== "system");
        if (firstCustom) {
          get().setTheme(firstCustom.id);
        } else {
          get().setTheme("default");
        }
      } else {
        get().setTheme(state.activeThemeId);
      }
    }
  },

  getThemeType: () => {
    const state = get();
    if (state.themeMode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    const activeTheme = state.themes.find((t) => t.id === state.activeThemeId);
    return activeTheme?.type === "light" ? "light" : "dark";
  },

  initSystemThemeListener: () => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (get().themeMode === "system") {
        get().setThemeMode("system");
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  },
}));
