import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Logger } from "../lib/logger";

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
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  themes: [
    {
      id: "default",
      name: "Modern Charcoal",
      type: "dark",
      colors: {
        "--color-background": "#0b0c0f",
        "--color-foreground": "#e6edf3",
        "--color-muted": "#11141a",
        "--color-muted-foreground": "#8b949e",
        "--color-popover": "#161b22",
        "--color-popover-foreground": "#ffffff",
        "--color-card": "#161a22",
        "--color-card-foreground": "#e6edf3",
        "--color-border": "rgba(255, 255, 255, 0.08)",
        "--color-input": "#0d0f14",
        "--color-primary": "#60a5fa",
        "--color-primary-foreground": "#ffffff",
        "--color-secondary": "#0d1117",
        "--color-secondary-foreground": "#8b949e",
        "--color-accent": "#1e2229",
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

  setTheme: async (themeId) => {
    const theme = get().themes.find((t) => t.id === themeId);
    if (theme) {
      set({ activeThemeId: themeId, themeMode: "custom" });
      localStorage.setItem("activeThemeId", themeId);
      localStorage.setItem("themeMode", "custom");
      // Cache colors for anti-flash on reboot
      localStorage.setItem("themeColors", JSON.stringify(theme.colors));

      // Apply Variables
      const root = document.documentElement;
      Object.entries(theme.colors).forEach(([key, value]) => {
        root.style.setProperty(key, value);
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
