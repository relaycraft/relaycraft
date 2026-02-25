import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Github,
  Globe,
  Info,
  Package as PackageIcon,
  Palette,
  RefreshCcw,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  XCircle,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUIStore } from "../../stores/uiStore";
import { AISettingsPanel } from "../ai/AISettingsPanel";
import { Button } from "../common/Button";
import { AppLogo } from "../layout/AppLogo";
import { AppearanceSettings } from "./AppearanceSettings";
import { CertificateSettings } from "./CertificateSettings";
import { MarketView } from "./MarketView";
import { PluginSettings } from "./PluginSettings";
import {
  SettingsInput,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsTabButton,
  SettingsToggle,
} from "./SettingsLayout";

export function SettingsView() {
  const { t } = useTranslation();
  const { availableLanguages, settingsTab, setSettingsTab, showConfirm } = useUIStore();
  const {
    config,
    updateProxyPort,
    updateSslInsecure,
    updateVerboseLogging,
    updateLanguage,
    updateUpstreamProxy,
    updateAlwaysOnTop,
    updateConfirmExit,
    updateAutoStartProxy,
    testingUpstream,
    upstreamStatus,
    testUpstreamConnectivity,
    resetUpstreamStatus,
  } = useSettingsStore();

  const { running, restartProxy } = useProxyStore();

  // Snapshot of network config at the time of last engine start/restart
  const networkSnapshot = React.useRef({
    proxy_port: config.proxy_port,
    ssl_insecure: config.ssl_insecure,
    upstream_proxy: config.upstream_proxy,
  });

  // Snapshot of verbose_logging at app startup (to detect changes requiring app restart)
  const verboseLoggingSnapshot = React.useRef(config.verbose_logging);

  // Track if verbose_logging has changed since app startup
  const verboseLoggingChanged = config.verbose_logging !== verboseLoggingSnapshot.current;

  // Track if network settings have changed since last restart
  const networkChanged =
    running &&
    (config.proxy_port !== networkSnapshot.current.proxy_port ||
      config.ssl_insecure !== networkSnapshot.current.ssl_insecure ||
      JSON.stringify(config.upstream_proxy) !==
        JSON.stringify(networkSnapshot.current.upstream_proxy));

  const [restarting, setRestarting] = React.useState(false);

  const handleRestartEngine = async () => {
    setRestarting(true);
    try {
      await restartProxy();
      // Update snapshot after successful restart
      networkSnapshot.current = {
        proxy_port: config.proxy_port,
        ssl_insecure: config.ssl_insecure,
        upstream_proxy: config.upstream_proxy,
      };
    } finally {
      setRestarting(false);
    }
  };

  const { setLogViewerOpen } = useUIStore();
  const [systemInfo, setSystemInfo] = React.useState<{
    version: string;
    platform: string;
    arch: string;
    engine: string;
    build_date: string;
  } | null>(null);

  React.useEffect(() => {
    invoke("get_system_info")
      .then((info: any) => setSystemInfo(info))
      .catch(console.error);
  }, []);

  // Clear upstream status on unmount
  React.useEffect(() => {
    return () => {
      resetUpstreamStatus();
    };
  }, [resetUpstreamStatus]);

  // Auto-clear upstream status after a few seconds
  React.useEffect(() => {
    if (upstreamStatus === "success" || upstreamStatus === "error") {
      const timer = setTimeout(() => {
        resetUpstreamStatus();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [upstreamStatus, resetUpstreamStatus]);

  const sidebar = (
    <>
      <SettingsTabButton
        label={t("settings.general.title")}
        icon={SettingsIcon}
        active={settingsTab === "general"}
        onClick={() => setSettingsTab("general")}
      />
      <SettingsTabButton
        label={t("settings.appearance.title")}
        icon={Palette}
        active={settingsTab === "appearance"}
        onClick={() => setSettingsTab("appearance")}
      />
      <SettingsTabButton
        label={t("settings.network.title")}
        icon={Globe}
        active={settingsTab === "network"}
        onClick={() => setSettingsTab("network")}
      />
      <SettingsTabButton
        label={t("ai.title")}
        icon={Sparkles}
        active={settingsTab === "ai"}
        onClick={() => setSettingsTab("ai")}
      />
      <SettingsTabButton
        label={t("plugins.title")}
        icon={PackageIcon}
        active={settingsTab === "plugins"}
        onClick={() => setSettingsTab("plugins")}
      />
      <SettingsTabButton
        label={t("sidebar.certificate")}
        icon={Shield}
        active={settingsTab === "certificate"}
        onClick={() => setSettingsTab("certificate")}
      />
      <SettingsTabButton
        label={t("settings.about.title")}
        icon={Info}
        active={settingsTab === "about"}
        onClick={() => setSettingsTab("about")}
      />
    </>
  );

  return (
    <SettingsPage sidebar={sidebar}>
      <AnimatePresence mode="wait">
        <motion.div
          key={settingsTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {settingsTab === "general" && (
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
          )}

          {settingsTab === "appearance" && <AppearanceSettings />}

          {settingsTab === "network" && (
            <SettingsSection title={t("settings.network.title")}>
              <SettingsRow
                title={t("settings.network.port")}
                description={t("settings.network.port_desc")}
              >
                <SettingsInput
                  value={config.proxy_port}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^\d*$/.test(val)) updateProxyPort(val === "" ? 0 : parseInt(val, 10));
                  }}
                  onBlur={(e) => {
                    let port = parseInt(e.target.value, 10) || 9090;
                    port = Math.max(1024, Math.min(65535, port));
                    updateProxyPort(port);
                  }}
                  className="w-24"
                />
              </SettingsRow>

              <SettingsRow
                title={t("settings.network.ssl_insecure")}
                description={
                  <span className="flex flex-col gap-1">
                    <span>{t("settings.network.ssl_insecure_desc")}</span>
                    {config.ssl_insecure && (
                      <span className="text-destructive inline-flex items-center gap-1 font-medium scale-90 origin-left">
                        <AlertTriangle className="w-3 h-3" /> {t("settings.network.mitm_risk")}
                      </span>
                    )}
                  </span>
                }
              >
                <SettingsToggle
                  checked={config.ssl_insecure}
                  onCheckedChange={(val) => updateSslInsecure(val)}
                />
              </SettingsRow>

              <SettingsRow
                title={t("settings.network.upstream_title")}
                description={t("settings.network.upstream_desc")}
              >
                <SettingsToggle
                  checked={config.upstream_proxy?.enabled}
                  onCheckedChange={(val) => {
                    updateUpstreamProxy({
                      ...config.upstream_proxy!,
                      enabled: val,
                    });
                  }}
                />
              </SettingsRow>

              {config.upstream_proxy?.enabled && (
                <div>
                  <SettingsRow
                    title={t("settings.network.upstream_url")}
                    description={t("settings.network.upstream_url_desc")}
                  >
                    <div className="flex flex-col items-end gap-2">
                      <SettingsInput
                        value={config.upstream_proxy?.url || ""}
                        onChange={(e) => {
                          updateUpstreamProxy({
                            ...config.upstream_proxy!,
                            url: e.target.value,
                          });
                          // Reset status when URL changes
                          resetUpstreamStatus();
                        }}
                        placeholder={t("settings.network.upstream_placeholder")}
                        className="w-64"
                      />
                      <div className="flex items-center gap-2">
                        {/* Connectivity Status Badge */}
                        {upstreamStatus !== "idle" && (
                          <div
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                              upstreamStatus === "success"
                                ? "text-green-600 bg-green-500/10"
                                : "text-destructive bg-destructive/10"
                            }`}
                          >
                            {upstreamStatus === "success" ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            {upstreamStatus === "success"
                              ? t("settings.network.upstream_check_success")
                              : t("settings.network.upstream_check_failed")}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="xs"
                          className="text-xs h-7 px-2 gap-1.5"
                          onClick={testUpstreamConnectivity}
                          disabled={testingUpstream || !config.upstream_proxy?.url}
                        >
                          {testingUpstream ? (
                            <RefreshCcw className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCcw className="w-3 h-3" />
                          )}
                          {testingUpstream
                            ? t("settings.network.upstream_checking")
                            : t("settings.network.upstream_check")}
                        </Button>
                      </div>
                    </div>
                  </SettingsRow>
                </div>
              )}

              <AnimatePresence>
                {networkChanged && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mx-0 mt-0 flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/8 border-t border-amber-500/20">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1 rounded-md bg-amber-500/15 text-amber-500 shrink-0">
                          <RefreshCcw className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 leading-tight">
                            {t("settings.network.pending_restart_title")}
                          </p>
                          <p className="text-xs text-amber-600/70 dark:text-amber-400/70 leading-tight mt-0.5">
                            {t("settings.network.pending_restart_desc")}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={handleRestartEngine}
                        disabled={restarting}
                        className="shrink-0 h-7 px-3 gap-1.5 text-xs border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/60"
                      >
                        <RefreshCcw className={`w-3 h-3 ${restarting ? "animate-spin" : ""}`} />
                        {restarting
                          ? t("settings.network.restarting")
                          : t("settings.network.restart_now")}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </SettingsSection>
          )}

          {settingsTab === "ai" && <AISettingsPanel />}

          {settingsTab === "plugins" && <PluginSettings />}

          {settingsTab === "certificate" && <CertificateSettings />}

          {settingsTab === "about" && (
            <div className="space-y-6">
              {/* Branding Section */}
              <div className="flex flex-col items-center justify-center py-5 bg-muted/20 rounded-xl border border-border/40">
                <AppLogo size={64} className="mb-4" />
                <h2 className="text-xl font-semibold text-foreground">RelayCraft</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  v{systemInfo?.version}
                  {systemInfo?.build_date
                    ? `(${new Date(systemInfo.build_date).toLocaleDateString("zh-CN")})`
                    : ""}
                </p>
              </div>

              <SettingsSection title={t("settings.about.title")}>
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-ui font-medium text-foreground">
                      RelayCraft v{systemInfo?.version}
                    </span>
                    <span className="text-ui text-muted-foreground">
                      {t("settings.about.checking_updates")}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      const btn = document.getElementById("btn-check-update");
                      if (btn) {
                        const originalText = btn.innerText;
                        btn.innerText = t("settings.about.checking");
                        btn.setAttribute("disabled", "true");

                        try {
                          const { check } = await import("@tauri-apps/plugin-updater");
                          const { relaunch } = await import("@tauri-apps/plugin-process");

                          const update = await check();
                          if (update) {
                            showConfirm({
                              title: t("settings.about.update_available.title"),
                              message: t("settings.about.update_available.message", {
                                version: update.version,
                                body: update.body || "",
                              }),
                              confirmLabel: t("common.yes"),
                              cancelLabel: t("common.no"),
                              variant: "info",
                              onConfirm: async () => {
                                btn.innerText = t("settings.about.downloading");
                                try {
                                  await update.downloadAndInstall();
                                  await relaunch();
                                } catch (error) {
                                  console.error("Installation failed:", error);
                                  const { notify } = await import("../../lib/notify");
                                  notify.error(t("settings.about.error_fetch"));
                                  btn.innerText = originalText;
                                  btn.removeAttribute("disabled");
                                }
                              },
                              onCancel: () => {
                                btn.innerText = originalText;
                                btn.removeAttribute("disabled");
                              },
                              customIcon: (
                                <div className="p-1 bg-primary/10 rounded-lg">
                                  <AppLogo size={24} />
                                </div>
                              ),
                            });
                          } else {
                            btn.innerText = t("settings.about.up_to_date");
                            setTimeout(() => {
                              btn.innerText = originalText;
                              btn.removeAttribute("disabled");
                            }, 2000);
                          }
                        } catch (e) {
                          console.error("Update check failed:", e);
                          const { notify } = await import("../../lib/notify");
                          const errorMsg = e instanceof Error ? e.message : String(e);
                          notify.error(`${t("settings.about.error_fetch")}\n${errorMsg}`);
                          btn.innerText = t("settings.about.check_failed");
                          setTimeout(() => {
                            btn.innerText = originalText;
                            btn.removeAttribute("disabled");
                          }, 3000);
                        }
                      }
                    }}
                    id="btn-check-update"
                    className="text-xs h-8 px-3"
                  >
                    {t("settings.about.check_update_btn")}
                  </Button>
                </div>
              </SettingsSection>

              <SettingsSection title={t("settings.about.troubleshooting")}>
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
                {/* Restart hint for verbose logging */}
                <AnimatePresence>
                  {verboseLoggingChanged && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg mt-2">
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
              </SettingsSection>

              <SettingsSection title={t("settings.about.dev_tools")}>
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

              <SettingsSection title={t("settings.about.links")}>
                <SettingsRow
                  title={t("settings.about.github")}
                  description={t("settings.about.github_desc")}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 text-xs font-medium text-primary/80 hover:text-primary"
                    onClick={async () => {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      openUrl("https://github.com/relaycraft/relaycraft").catch(console.error);
                    }}
                  >
                    <Github className="w-3.5 h-3.5" />
                    {t("settings.about.visit_github")}
                  </Button>
                </SettingsRow>
                <SettingsRow
                  title={t("settings.about.mitmproxy")}
                  description={t("settings.about.mitmproxy_desc")}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 text-xs font-medium text-primary/80 hover:text-primary"
                    onClick={async () => {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      openUrl("https://github.com/mitmproxy/mitmproxy").catch(console.error);
                    }}
                  >
                    <Github className="w-3.5 h-3.5" />
                    {t("settings.about.visit_engine")}
                  </Button>
                </SettingsRow>
                <SettingsRow
                  title={t("settings.about.homepage")}
                  description={t("settings.about.homepage_desc")}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 text-xs font-medium text-primary/80 hover:text-primary"
                    onClick={async () => {
                      const { openUrl } = await import("@tauri-apps/plugin-opener");
                      openUrl("https://www.relaycraft.dev").catch(console.error);
                    }}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {t("settings.about.visit_website")}
                  </Button>
                </SettingsRow>
              </SettingsSection>
            </div>
          )}

          <div className="text-center pt-8 pb-8">
            <p className="text-xs text-muted-foreground/25 tracking-tight font-medium">
              {systemInfo
                ? `RelayCraft v${systemInfo.version} · ${systemInfo.platform} ${systemInfo.arch} · Relay Engine: ${systemInfo.engine}`
                : t("settings.footer")}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Modals */}
      <MarketView />
    </SettingsPage>
  );
}
