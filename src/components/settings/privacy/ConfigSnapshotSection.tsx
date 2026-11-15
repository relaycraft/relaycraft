import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Camera, Check, Download, FileWarning, ShieldAlert, Upload } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Logger } from "../../../lib/logger";
import { notify } from "../../../lib/notify";
import { cn } from "../../../lib/utils";
import { useAIStore } from "../../../stores/aiStore";
import { usePluginStore } from "../../../stores/pluginStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import type {
  SnapshotExportResult,
  SnapshotImportResult,
  SnapshotPreview,
} from "../../../types/snapshot";
import { Button } from "../../common/Button";
import { Modal } from "../../common/Modal";
import { SettingsSection } from "../SettingsLayout";

/**
 * Whether a proxy URL embeds userinfo credentials (`user:pass@host`).
 * Mirrors `upstream_url_has_credentials` in snapshot.rs — parse when a
 * scheme is present, otherwise fall back to an `@` scan.
 */
function urlHasCredentials(raw: string | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    return parsed.username !== "" || parsed.password !== "";
  } catch {
    return value.includes("@");
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value === "" ? '""' : value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function ValueCell({ value, tone }: { value: unknown; tone: "current" | "incoming" }) {
  return (
    <code
      className={cn(
        "min-w-0 break-all rounded-md px-1.5 py-0.5 font-mono text-tiny",
        tone === "current" ? "bg-muted/50 text-muted-foreground" : "bg-primary/10 text-primary",
      )}
      title={formatValue(value)}
    >
      {formatValue(value)}
    </code>
  );
}

interface PreviewState {
  path: string;
  preview: SnapshotPreview;
}

export function ConfigSnapshotSection() {
  const { t } = useTranslation();
  const upstreamProxyUrl = useSettingsStore((state) => state.config.upstream_proxy?.url);
  const loadConfig = useSettingsStore((state) => state.loadConfig);
  const syncPluginsWithConfig = usePluginStore((state) => state.syncPluginsWithConfig);

  const [exporting, setExporting] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [previewState, setPreviewState] = React.useState<PreviewState | null>(null);
  const [checkedMachineBound, setCheckedMachineBound] = React.useState<Set<string>>(new Set());

  const proxyHasCredentials = urlHasCredentials(upstreamProxyUrl);

  const handleExport = async () => {
    setExporting(true);
    try {
      const path = await save({
        filters: [
          {
            name: t("privacy.snapshot.file_filter"),
            extensions: ["json"],
          },
        ],
        defaultPath: "relaycraft-snapshot.json",
      });
      if (!path) return;

      const result = await invoke<SnapshotExportResult>("export_config_snapshot", { path });
      notify.success(
        t("privacy.snapshot.export_success", {
          settings: result.settings_count,
          plugins: result.plugin_count,
        }),
        t("privacy.snapshot.title"),
      );
      if (result.includes_proxy_credentials) {
        notify.warning(t("privacy.snapshot.proxy_credentials_warning"), {
          title: t("privacy.snapshot.title"),
          toastOnly: true,
        });
      }
    } catch (error) {
      Logger.error("Config snapshot export failed:", error);
      notify.error(String(error), t("privacy.snapshot.title"));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setPreviewing(true);
    try {
      const path = await open({
        multiple: false,
        filters: [
          {
            name: t("privacy.snapshot.file_filter"),
            extensions: ["json"],
          },
        ],
      });
      if (!path || typeof path !== "string") return;

      const preview = await invoke<SnapshotPreview>("preview_config_snapshot", { path });
      setCheckedMachineBound(new Set());
      setPreviewState({ path, preview });
    } catch (error) {
      Logger.error("Config snapshot preview failed:", error);
      notify.error(String(error), t("privacy.snapshot.title"));
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!previewState) return;
    setApplying(true);
    try {
      const result = await invoke<SnapshotImportResult>("apply_config_snapshot", {
        path: previewState.path,
        applyMachineBound: Array.from(checkedMachineBound),
      });
      if (result.error) {
        notify.error(result.error, t("privacy.snapshot.title"));
        if (result.partial) {
          notify.warning(t("privacy.snapshot.apply_partial"), {
            title: t("privacy.snapshot.title"),
          });
        }
        return;
      }

      // Re-read config so settings surfaces reflect the imported values —
      // same contract as a manual save. Consumers that keep their own
      // runtime copies are synced below.
      await loadConfig();
      const newConfig = useSettingsStore.getState().config;

      // Applied MCP listener fields go live immediately — the same apply
      // path the MCP settings toggle uses.
      if (["mcp_enabled", "mcp_port"].some((key) => checkedMachineBound.has(key))) {
        try {
          await invoke("apply_mcp_config");
        } catch (error) {
          Logger.error("Failed to apply MCP config after snapshot import:", error);
        }
      }

      // Window-level settings mirror the manual save paths (idempotent).
      try {
        await getCurrentWindow().setAlwaysOnTop(newConfig.always_on_top);
      } catch (error) {
        Logger.error("Failed to apply always-on-top after snapshot import:", error);
      }
      // Same lazy-import pattern as settingsStore.updateEnableVibrancy —
      // avoids a circular init between the two stores.
      import("../../../stores/themeStore")
        .then((m) => m.useThemeStore.getState().applyVibrancy())
        .catch((e) => Logger.error("Failed to apply vibrancy:", e));

      // Snapshot merge only ever enables plugins — load the UI of each
      // newly enabled one.
      await syncPluginsWithConfig();

      // The AI settings panel keeps its own store copy — re-pull so a
      // mounted settings view doesn't show stale provider/model values.
      await useAIStore.getState().loadSettings();

      notify.success(
        t("privacy.snapshot.apply_success", {
          applied: result.applied_settings,
          bound: result.applied_machine_bound,
          plugins: result.plugins_enabled,
        }) + (result.restart_required ? ` ${t("privacy.snapshot.apply_restart_hint")}` : ""),
        t("privacy.snapshot.title"),
      );
      setPreviewState(null);
    } catch (error) {
      Logger.error("Config snapshot apply failed:", error);
      notify.error(String(error), t("privacy.snapshot.title"));
    } finally {
      setApplying(false);
    }
  };

  const toggleMachineBound = (key: string) => {
    setCheckedMachineBound((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const preview = previewState?.preview;
  const pluginBuckets: {
    title: string;
    entries: { id: string; version?: string; enabled: boolean }[];
    tone: "restore" | "missing" | "matching" | "not_restored";
  }[] = preview
    ? [
        {
          title: t("privacy.snapshot.plugins_restore"),
          entries: preview.plugins_restore,
          tone: "restore",
        },
        {
          title: t("privacy.snapshot.plugins_missing"),
          entries: preview.plugins_missing,
          tone: "missing",
        },
        {
          title: t("privacy.snapshot.plugins_matching"),
          entries: preview.plugins_already_matching,
          tone: "matching",
        },
        {
          title: t("privacy.snapshot.plugins_not_restored"),
          entries: preview.plugins_not_restored,
          tone: "not_restored",
        },
      ]
    : [];

  return (
    <SettingsSection title={t("privacy.snapshot.title")}>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground/80 leading-relaxed">
          {t("privacy.snapshot.desc")}
        </p>

        {proxyHasCredentials && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              {t("privacy.snapshot.proxy_credentials_warning")}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={handleExport}
            isLoading={exporting}
          >
            <Download className="h-3.5 w-3.5" />
            {t("privacy.snapshot.export")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={handleImport}
            isLoading={previewing}
          >
            <Upload className="h-3.5 w-3.5" />
            {t("privacy.snapshot.import")}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={!!previewState}
        onClose={() => !applying && setPreviewState(null)}
        title={t("privacy.snapshot.preview_title")}
        subtitle={
          preview?.name ? (
            <span className="text-tiny text-muted-foreground/70">{preview.name}</span>
          ) : undefined
        }
        icon={<Camera className="h-4 w-4 text-primary" />}
        className="max-w-2xl"
        preventDismiss={applying}
      >
        {preview && (
          <div className="space-y-4">
            {!preview.host_compatible && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-destructive">
                  {t("privacy.snapshot.blocked_version", {
                    requirement: preview.requires_host ?? "?",
                    current: preview.host_version,
                  })}
                </p>
              </div>
            )}

            {/* Settings diff */}
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                {t("privacy.snapshot.sections.settings")}
              </h4>
              {preview.settings.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground/60">
                  {t("privacy.snapshot.empty_diff")}
                </p>
              ) : (
                <div className="divide-y divide-border/30 rounded-lg border border-border/40">
                  {preview.settings.map((diff) => (
                    <div key={diff.key} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="w-40 shrink-0 font-mono font-semibold text-foreground">
                        {diff.key}
                      </span>
                      <ValueCell value={diff.current} tone="current" />
                      <span className="shrink-0 text-muted-foreground/50">→</span>
                      <ValueCell value={diff.incoming} tone="incoming" />
                    </div>
                  ))}
                </div>
              )}
              {preview.unchanged_settings > 0 && (
                <p className="mt-1 px-1 text-tiny text-muted-foreground/50">
                  {t("privacy.snapshot.unchanged", { count: preview.unchanged_settings })}
                </p>
              )}
            </section>

            {/* Machine-bound fields — opt-in per field, no select-all */}
            {preview.machine_bound.length > 0 && (
              <section>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {t("privacy.snapshot.sections.machine_bound")}
                </h4>
                <p className="mb-1.5 px-1 text-tiny leading-relaxed text-muted-foreground/60">
                  {t("privacy.snapshot.machine_bound_hint")}
                </p>
                <div className="divide-y divide-border/30 rounded-lg border border-border/40">
                  {preview.machine_bound.map((entry) => {
                    const checked = checkedMachineBound.has(entry.key);
                    return (
                      <label
                        key={entry.key}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs hover:bg-muted/30"
                      >
                        <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          <input
                            type="checkbox"
                            className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
                            checked={checked}
                            onChange={() => toggleMachineBound(entry.key)}
                          />
                          <span
                            aria-hidden
                            className={cn(
                              "flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors",
                              checked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/80 bg-muted/40 peer-hover:border-muted-foreground/50",
                            )}
                          >
                            {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                          </span>
                        </span>
                        <span className="w-40 shrink-0 font-mono font-semibold text-foreground">
                          {entry.key}
                        </span>
                        <ValueCell value={entry.current} tone="current" />
                        <span className="shrink-0 text-muted-foreground/50">→</span>
                        <ValueCell value={entry.incoming} tone="incoming" />
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Plugins */}
            {pluginBuckets.some((bucket) => bucket.entries.length > 0) && (
              <section>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {t("privacy.snapshot.sections.plugins")}
                </h4>
                <div className="space-y-2">
                  {pluginBuckets
                    .filter((bucket) => bucket.entries.length > 0)
                    .map((bucket) => (
                      <div
                        key={bucket.tone}
                        className="rounded-lg border border-border/40 px-3 py-2"
                      >
                        <p
                          className={cn(
                            "text-tiny font-bold uppercase tracking-wider",
                            bucket.tone === "restore" && "text-primary",
                            bucket.tone === "missing" && "text-amber-600 dark:text-amber-400",
                            bucket.tone === "matching" && "text-muted-foreground/60",
                            bucket.tone === "not_restored" && "text-muted-foreground/60",
                          )}
                        >
                          {bucket.title} ({bucket.entries.length})
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {bucket.entries.map((entry) => (
                            <li
                              key={entry.id}
                              className="flex items-center gap-2 text-xs text-foreground/90"
                            >
                              <code className="font-mono">{entry.id}</code>
                              {entry.version && (
                                <span className="text-tiny text-muted-foreground/60">
                                  v{entry.version}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {/* Ignored content notices */}
            {(preview.proxy_credentials ||
              preview.ignored_secrets.length > 0 ||
              preview.ignored_unknown.length > 0 ||
              preview.invalid_settings.length > 0 ||
              preview.invalid_machine_bound.length > 0) && (
              <section className="space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
                {preview.proxy_credentials && (
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    {t("privacy.snapshot.incoming_proxy_credentials")}
                  </p>
                )}
                {preview.ignored_secrets.length > 0 && (
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    {t("privacy.snapshot.secrets_ignored", {
                      keys: preview.ignored_secrets.join(", "),
                    })}
                  </p>
                )}
                {preview.ignored_unknown.length > 0 && (
                  <p className="text-tiny leading-relaxed text-muted-foreground/70">
                    {t("privacy.snapshot.unknown_ignored", {
                      keys: preview.ignored_unknown.join(", "),
                    })}
                  </p>
                )}
                {(preview.invalid_settings.length > 0 ||
                  preview.invalid_machine_bound.length > 0) && (
                  <p className="text-tiny leading-relaxed text-muted-foreground/70">
                    {t("privacy.snapshot.invalid_ignored", {
                      keys: [...preview.invalid_settings, ...preview.invalid_machine_bound].join(
                        ", ",
                      ),
                    })}
                  </p>
                )}
              </section>
            )}

            <p className="px-1 text-tiny leading-relaxed text-muted-foreground/50">
              {t("privacy.snapshot.apply_note")}
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setPreviewState(null)} disabled={applying}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleApply}
                disabled={!preview.host_compatible || applying}
                isLoading={applying}
                className="shadow-sm shadow-primary/20"
              >
                {t("privacy.snapshot.apply")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </SettingsSection>
  );
}
