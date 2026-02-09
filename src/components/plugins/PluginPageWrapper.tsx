import type React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore } from "../../stores/themeStore";
import type { PluginAPI } from "../../types/plugin";

interface PluginPageWrapperProps {
  pluginId: string;
  component: React.ComponentType<any>;
}

export const PluginPageWrapper: React.FC<PluginPageWrapperProps> = ({
  pluginId,
  component: Component,
}) => {
  const { config } = useSettingsStore();
  const { themeMode } = useThemeStore();
  const { t, i18n } = useTranslation();

  // Retrieve the scoped API for this plugin
  const api: PluginAPI = (window as any).__PLUGIN_APIS?.[pluginId];

  if (!api) {
    return (
      <div className="flex items-center justify-center h-full text-destructive">
        {t("plugins.api_error", { pluginId })}
      </div>
    );
  }

  const appContext = {
    theme: themeMode, // 'system', 'light', 'dark', 'custom'
    locale: i18n.language,
    settings: config,
  };

  return (
    <div className="w-full h-full animate-in fade-in duration-300" data-theme={themeMode}>
      <Component appContext={appContext} api={api} RelayCraft={{ api }} />
    </div>
  );
};
