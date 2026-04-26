import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, RefreshCcw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { SettingsRow, SettingsSection, SettingsToggle } from "./SettingsLayout";

interface SystemInfo {
  version: string;
  platform: string;
  arch: string;
  engine: string;
  build_date: string;
}

interface AdvancedSettingsProps {
  systemInfo: SystemInfo | null;
}

export function AdvancedSettings({ systemInfo }: AdvancedSettingsProps) {
  const { t } = useTranslation();
  const { config, loading, updateVerboseLogging, updateDisableGpuAcceleration } =
    useSettingsStore();
  const { setLogViewerOpen } = useUIStore();

  const verboseLoggingSnapshot = React.useRef(config.verbose_logging);
  const verboseLoggingChanged = config.verbose_logging !== verboseLoggingSnapshot.current;

  const isWindows = React.useMemo(() => {
    if (systemInfo?.platform) return /win/i.test(systemInfo.platform);
    return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  }, [systemInfo?.platform]);

  const disableGpuSnapshot = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    if (!isWindows || loading || disableGpuSnapshot.current !== null) return;
    disableGpuSnapshot.current = config.disable_gpu_acceleration;
  }, [config.disable_gpu_acceleration, isWindows, loading]);

  const disableGpuChanged =
    isWindows &&
    disableGpuSnapshot.current !== null &&
    config.disable_gpu_acceleration !== disableGpuSnapshot.current;

  return (
    <div className="space-y-6 pb-24">
      <SettingsSection title={t("settings.advanced.troubleshooting")}>
        <SettingsRow
          title={t("settings.about.verbose")}
          description={t("settings.about.verbose_desc")}
        >
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLogViewerOpen(true)}
              className="text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary"
            >
              {t("settings.about.view_logs")}
            </Button>
            <SettingsToggle
              checked={config.verbose_logging}
              onCheckedChange={(val) => updateVerboseLogging(val)}
            />
          </div>
        </SettingsRow>
        <AnimatePresence>
          {verboseLoggingChanged && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                <div className="p-1 rounded-md bg-amber-500/15 text-amber-500 shrink-0">
                  <RefreshCcw className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 leading-tight">
                    {t("settings.about.verbose_restart_title")}
                  </p>
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70 leading-tight mt-0.5">
                    {t("settings.about.verbose_restart_desc")}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {isWindows && (
          <>
            <SettingsRow
              title={t("settings.advanced.disable_gpu")}
              description={t("settings.advanced.disable_gpu_desc")}
            >
              <SettingsToggle
                checked={config.disable_gpu_acceleration}
                onCheckedChange={(val) => updateDisableGpuAcceleration(val)}
              />
            </SettingsRow>
            <AnimatePresence>
              {disableGpuChanged && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                    <div className="p-1 rounded-md bg-amber-500/15 text-amber-500 shrink-0">
                      <RefreshCcw className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 leading-tight">
                        {t("settings.advanced.disable_gpu_restart_title")}
                      </p>
                      <p className="text-xs text-amber-600/70 dark:text-amber-400/70 leading-tight mt-0.5">
                        {t("settings.advanced.disable_gpu_restart_desc")}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t("settings.advanced.directories")}>
        <SettingsRow
          title={t("settings.about.open_config")}
          description={t("settings.about.open_config_desc")}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-xs font-medium"
            onClick={() => invoke("open_config_dir").catch(console.error)}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t("common.open")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t("settings.about.open_data")}
          description={t("settings.about.open_data_desc")}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-xs font-medium"
            onClick={() => invoke("open_data_dir").catch(console.error)}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t("common.open")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t("settings.about.open_logs")}
          description={t("settings.about.open_logs_desc")}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-xs font-medium"
            onClick={() => invoke("open_logs_dir").catch(console.error)}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            {t("common.open")}
          </Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
