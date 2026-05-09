import { Globe, Shield } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { GitHubMark } from "../common/icons/GitHubMark";
import { AppLogo } from "../layout/AppLogo";
import { LicensesModal } from "./LicensesModal";
import { SettingsRow, SettingsSection } from "./SettingsLayout";

interface SystemInfo {
  version: string;
  platform: string;
  arch: string;
  engine: string;
  build_date: string;
}

interface AboutSettingsProps {
  systemInfo: SystemInfo | null;
}

export function AboutSettings({ systemInfo }: AboutSettingsProps) {
  const { t } = useTranslation();
  const { showConfirm } = useUIStore();
  const [licensesOpen, setLicensesOpen] = React.useState(false);

  return (
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

      <SettingsSection title={t("settings.about.version_info")}>
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
                          try {
                            const { invoke } = await import("@tauri-apps/api/core");
                            await invoke("prepare_update_install");
                          } catch (_) {
                            try {
                              const { invoke } = await import("@tauri-apps/api/core");
                              await invoke("stop_proxy");
                            } catch (_) {}
                          }
                          await update.downloadAndInstall();
                          await relaunch();
                        } catch (error) {
                          console.error("Installation failed:", error);
                          try {
                            const { invoke } = await import("@tauri-apps/api/core");
                            await invoke("restart_proxy");
                          } catch (_) {}
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

      <SettingsSection title={t("settings.about.links")}>
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
            <GitHubMark className="w-3.5 h-3.5" />
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
            <GitHubMark className="w-3.5 h-3.5" />
            {t("settings.about.visit_engine")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t("settings.about.app_license", "Product License")}
          description={t(
            "settings.about.app_license_desc",
            "RelayCraft is released under the GNU General Public License v3.0",
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-xs font-medium text-primary/80 hover:text-primary"
            onClick={async () => {
              const { openUrl } = await import("@tauri-apps/plugin-opener");
              openUrl("https://github.com/relaycraft/relaycraft/blob/main/LICENSE").catch(
                console.error,
              );
            }}
          >
            <Shield className="w-3.5 h-3.5" />
            {t("common.view", "View")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t("settings.about.licenses.title_short", "Open Source Licenses")}
          description={t("settings.about.licenses.row_desc", "View third-party software licenses")}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 text-xs font-medium text-primary/80 hover:text-primary"
            onClick={() => setLicensesOpen(true)}
          >
            <Shield className="w-3.5 h-3.5" />
            {t("common.view", "View")}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <LicensesModal isOpen={licensesOpen} onClose={() => setLicensesOpen(false)} />
    </div>
  );
}
