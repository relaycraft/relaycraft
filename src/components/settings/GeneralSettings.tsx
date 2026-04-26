import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import { SettingsRow, SettingsSection, SettingsSelect, SettingsToggle } from "./SettingsLayout";

export function GeneralSettings() {
  const { t } = useTranslation();
  const { availableLanguages } = useUIStore();
  const { config, updateLanguage, updateAlwaysOnTop, updateConfirmExit, updateAutoStartProxy } =
    useSettingsStore();

  return (
    <SettingsSection title={t("settings.general.title")}>
      <SettingsRow
        title={t("settings.general.language")}
        description={t("settings.general.language_desc")}
      >
        <SettingsSelect
          value={config.language || "zh"}
          onChange={(val) => updateLanguage(val)}
          options={availableLanguages}
        />
      </SettingsRow>

      <SettingsRow
        title={t("settings.general.always_on_top")}
        description={t("settings.general.always_on_top_desc")}
      >
        <SettingsToggle
          checked={config.always_on_top}
          onCheckedChange={(val) => updateAlwaysOnTop(val)}
        />
      </SettingsRow>

      <SettingsRow
        title={t("settings.general.confirm_exit")}
        description={t("settings.general.confirm_exit_desc")}
      >
        <SettingsToggle
          checked={config.confirm_exit}
          onCheckedChange={(val) => updateConfirmExit(val)}
        />
      </SettingsRow>

      <SettingsRow
        title={t("settings.general.auto_start_proxy")}
        description={t("settings.general.auto_start_proxy_desc")}
      >
        <SettingsToggle
          checked={config.auto_start_proxy}
          onCheckedChange={(val) => updateAutoStartProxy(val)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
