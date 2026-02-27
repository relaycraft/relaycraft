import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Logger } from "../lib/logger";
import { useSettingsStore } from "./settingsStore";
import { useUIStore } from "./uiStore";

/**
 * CSS variables that are specifically for vibrancy/blur backgrounds.
 * Only these variables will have their rgba values blended when vibrancy is disabled.
 * Other rgba colors (like borders, shadows) are preserved for their intended effects.
 */
const VIBRANCY_RELATED_VARS = new Set([
  "--color-background",
  "--color-muted",
  "--color-popover",
  "--color-card",
  "--color-input",
  "--color-secondary",
  "--color-accent",
]);

/**
 * Platform-specific alpha compensation configuration.
 * Windows requires higher opacity (less transparency) than macOS for similar visual effect
 * due to differences in DWM composition vs NSVisualEffectView.
 */
const ALPHA_COMPENSATION_CONFIG = {
  /** Compensation factor for Windows: newAlpha = alpha + (1 - alpha) * factor */
  windowsFactor: 0.45,
  /** Maximum alpha cap to prevent fully opaque colors */
  maxAlpha: 0.95,
  /** Alpha threshold below which compensation is applied (skip already-opaque colors) */
  alphaThreshold: 0.9,
} as const;

/**
 * Apply platform-specific alpha compensation for vibrancy colors.
 * On Windows, the DWM blur effect is weaker than macOS's NSVisualEffectView,
 * so we need to increase opacity to prevent the background from being too visible.
 *
 * Formula: newAlpha = alpha + (1 - alpha) * factor
 * This progressively increases opacity while preserving relative transparency differences.
 *
 * @example
 * - 0.4 → 0.67 (significant boost for very transparent colors)
 * - 0.5 → 0.725 (moderate boost)
 * - 0.7 → 0.835 (subtle boost for already opaque colors)
 * - 0.85 → 0.9175 (minimal adjustment near threshold)
 */
function compensateAlphaForPlatform(alpha: number, isMac: boolean): number {
  if (isMac) return alpha; // macOS: use original alpha as-is

  // Windows: apply compensation formula
  const { windowsFactor, maxAlpha, alphaThreshold } = ALPHA_COMPENSATION_CONFIG;

  // Skip colors that are already sufficiently opaque
  if (alpha >= alphaThreshold) return alpha;

  // Apply progressive compensation: newAlpha = alpha + (1 - alpha) * factor
  const compensated = alpha + (1 - alpha) * windowsFactor;

  // Cap at maximum to prevent fully opaque
  return Math.min(compensated, maxAlpha);
}

/**
 * Blend semi-transparent rgba() color with a background color.
 * When vibrancy is disabled, we need to composite rgba colors onto a solid background.
 * For dark themes, blend onto near-black; for light themes, blend onto near-white.
 */
function blendRgbaWithBackground(
  r: number,
  g: number,
  b: number,
  a: number,
  isDarkTheme: boolean,
): string {
  // Background color depends on theme type
  const bgR = isDarkTheme ? 11 : 252; // Match --color-background base
  const bgG = isDarkTheme ? 12 : 253;
  const bgB = isDarkTheme ? 15 : 253;

  // Alpha blending: result = foreground * alpha + background * (1 - alpha)
  const outR = Math.round(r * a + bgR * (1 - a));
  const outG = Math.round(g * a + bgG * (1 - a));
  const outB = Math.round(b * a + bgB * (1 - a));

  return `rgb(${outR}, ${outG}, ${outB})`;
}

/**
 * Process color value for vibrancy setting.
 * Only processes rgba() values for vibrancy-related CSS variables.
 *
 * Two-stage processing:
 * 1. Platform alpha compensation (when vibrancy enabled) - adjusts transparency for OS differences
 * 2. Background blending (when vibrancy disabled) - composites onto solid background
 */
function processColorForVibrancy(
  varName: string,
  value: string,
  vibrancyEnabled: boolean,
  isDarkTheme: boolean,
): string {
  // Only process vibrancy-related variables
  if (!VIBRANCY_RELATED_VARS.has(varName)) {
    return value;
  }

  // Match rgba(r, g, b, a) format (with optional spaces)
  const rgbaMatch = value.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!rgbaMatch) {
    return value; // Not an rgba color, pass through
  }

  const r = Number.parseInt(rgbaMatch[1], 10);
  const g = Number.parseInt(rgbaMatch[2], 10);
  const b = Number.parseInt(rgbaMatch[3], 10);
  const originalAlpha = Number.parseFloat(rgbaMatch[4]);

  // When vibrancy is disabled, blend with solid background
  if (!vibrancyEnabled) {
    return blendRgbaWithBackground(r, g, b, originalAlpha, isDarkTheme);
  }

  // When vibrancy is enabled, apply platform-specific alpha compensation
  const isMac = useUIStore.getState().isMac;
  const compensatedAlpha = compensateAlphaForPlatform(originalAlpha, isMac);

  // Return rgba with compensated alpha (or original if no change)
  if (compensatedAlpha === originalAlpha) {
    return value;
  }

  return `rgba(${r}, ${g}, ${b}, ${compensatedAlpha})`;
}

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
        "--color-background": "rgba(11, 12, 15, 0.4)",
        "--color-foreground": "#e6edf3",
        "--color-muted": "rgba(17, 20, 26, 0.45)",
        "--color-muted-foreground": "#8b949e",
        "--color-popover": "rgba(22, 27, 34, 0.75)",
        "--color-popover-foreground": "#ffffff",
        "--color-card": "rgba(22, 26, 34, 0.75)",
        "--color-card-foreground": "#e6edf3",
        "--color-border": "rgba(255, 255, 255, 0.08)",
        "--color-input": "rgba(13, 15, 20, 0.6)",
        "--color-primary": "#60a5fa",
        "--color-primary-foreground": "#ffffff",
        "--color-secondary": "rgba(13, 17, 23, 0.5)",
        "--color-secondary-foreground": "#8b949e",
        "--color-accent": "rgba(30, 34, 41, 0.6)",
        "--color-accent-foreground": "#ffffff",
        "--color-destructive": "#fb7185",
        "--color-destructive-foreground": "#ffffff",
        "--color-success": "#10b981",
        "--color-success-foreground": "#ffffff",
        "--color-warning": "#f59e0b",
        "--color-warning-foreground": "#000000",
        "--color-info": "#3b82f6",
        "--color-info-foreground": "#ffffff",
        "--color-ring": "#3b82f6",

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

        /* Borders - Dark */
        "--color-border-subtle": "rgba(255, 255, 255, 0.04)",
        "--color-border-muted": "rgba(255, 255, 255, 0.12)",

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
        "--color-background": "#fcfcfd",
        "--color-foreground": "#1a1c23",
        "--color-muted": "#f4f4f7",
        "--color-muted-foreground": "#6b7280",
        "--color-popover": "#ffffff",
        "--color-popover-foreground": "#1a1c23",
        "--color-card": "#ffffff",
        "--color-card-foreground": "#1a1c23",
        "--color-border": "#e5e7eb",
        "--color-input": "#ffffff",
        "--color-primary": "#4f46e5",
        "--color-primary-foreground": "#ffffff",
        "--color-secondary": "#f4f4f7",
        "--color-secondary-foreground": "#4f46e5",
        "--color-accent": "#eef2ff",
        "--color-accent-foreground": "#4f46e5",
        "--color-destructive": "#ef4444",
        "--color-destructive-foreground": "#ffffff",
        "--color-success": "#10b981",
        "--color-success-foreground": "#ffffff",
        "--color-warning": "#f59e0b",
        "--color-warning-foreground": "#ffffff",
        "--color-info": "#3b82f6",
        "--color-info-foreground": "#ffffff",
        "--color-ring": "#4f46e5",

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

        /* Borders - Light */
        "--color-border-subtle": "rgba(0, 0, 0, 0.02)",
        "--color-border-muted": "rgba(0, 0, 0, 0.06)",

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

    Logger.debug(
      `[ThemeStore] applyVibrancy -> enabled: ${vibrancyEnabled}, isDark: ${isDarkTheme}`,
    );

    // Re-apply current theme colors with vibrancy processing
    // This blends rgba() colors with appropriate background when vibrancy is disabled
    const activeTheme = themes.find((t) => t.id === activeThemeId);
    if (activeTheme) {
      const root = document.documentElement;
      Object.entries(activeTheme.colors).forEach(([key, value]) => {
        const processedValue = processColorForVibrancy(key, value, vibrancyEnabled, isDarkTheme);
        root.style.setProperty(key, processedValue);
      });
    }

    // Send effect to Rust backend
    const effect = vibrancyEnabled ? getThemeType() : "none";
    invoke("set_window_vibrancy", { effect }).catch((err) => {
      Logger.error("[ThemeStore] Failed to set window vibrancy:", err);
    });
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

      // Apply Variables (blend rgba with background if vibrancy disabled)
      const root = document.documentElement;
      Object.entries(theme.colors).forEach(([key, value]) => {
        const processedValue = processColorForVibrancy(key, value, vibrancyEnabled, isDarkTheme);
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
