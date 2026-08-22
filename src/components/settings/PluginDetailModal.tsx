import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { getPluginCallStats, type PluginCallStat } from "../../plugins/callStats";
import { type BridgeCommandSpec, getPluginApiContract } from "../../plugins/contract";
import {
  getPermissionMeta,
  getPermissionUsage,
  type PermissionRisk,
} from "../../plugins/permissions";
import { usePluginRuntimeStore } from "../../stores/pluginRuntimeStore";
import { usePluginStore } from "../../stores/pluginStore";
import { Modal } from "../common/Modal";

const RISK_STYLES: Record<PermissionRisk, string> = {
  low: "bg-green-500/10 text-green-600 dark:text-green-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
};

function formatTime(isoOrMillis: string | number): string {
  const date = typeof isoOrMillis === "number" ? new Date(isoOrMillis) : new Date(isoOrMillis);
  return Number.isNaN(date.getTime()) ? String(isoOrMillis) : date.toLocaleString();
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
      {title}
    </h4>
    {children}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-2 text-ui">
    <span className="shrink-0 text-muted-foreground/60 w-20">{label}</span>
    <span className="min-w-0 flex-1 break-all text-foreground/90">{children}</span>
  </div>
);

interface PluginDetailModalProps {
  pluginId: string | null;
  open: boolean;
  onClose: () => void;
}

export const PluginDetailModal: React.FC<PluginDetailModalProps> = ({
  pluginId,
  open,
  onClose,
}) => {
  const { t, i18n } = useTranslation();
  const plugin = usePluginStore((state) =>
    pluginId ? state.plugins.find((p) => p.manifest.id === pluginId) : undefined,
  );
  const loadResult = usePluginRuntimeStore((state) =>
    pluginId ? state.loadResults[pluginId] : undefined,
  );

  const [contract, setContract] = React.useState<BridgeCommandSpec[] | null>(null);
  const [callStats, setCallStats] = React.useState<PluginCallStat[] | null>(null);
  const [statsError, setStatsError] = React.useState(false);

  React.useEffect(() => {
    if (!(open && pluginId)) return;
    let cancelled = false;
    setContract(null);
    setCallStats(null);
    setStatsError(false);
    getPluginApiContract()
      .then((specs) => {
        if (!cancelled) setContract(specs);
      })
      .catch(() => {
        if (!cancelled) setStatsError(true);
      });
    getPluginCallStats()
      .then((stats) => {
        if (!cancelled) setCallStats(stats.filter((s) => s.plugin_id === pluginId));
      })
      .catch(() => {
        if (!cancelled) setStatsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pluginId]);

  if (!plugin) return null;

  const { manifest } = plugin;
  const locale = i18n.language?.split("-")[0] || "en";
  const localized = manifest.locales?.[locale];
  const displayName = localized?.name || manifest.name;
  const displayDescription =
    localized?.description || manifest.description || t("plugins.no_description");

  const isPython = !!manifest.capabilities?.logic?.entry || !!manifest.entry?.python;
  const isUI =
    !!manifest.capabilities?.ui?.entry || !!manifest.entry?.ui || !!manifest.capabilities?.i18n;

  const compatibility = plugin.compatibility;
  const incompatible = compatibility ? !compatibility.compatible : false;

  const permissions = manifest.permissions ?? [];
  const usage = contract ? getPermissionUsage(permissions, contract) : null;

  return (
    <Modal isOpen={open} onClose={onClose} title={displayName} className="max-w-xl">
      <div className="space-y-5">
        {/* Overview */}
        <Section title={t("plugins.detail.overview")}>
          <div className="space-y-1.5 rounded-xl border border-border/30 bg-muted/5 p-3">
            <Field label={t("plugins.detail.version")}>
              <span className="flex items-center gap-1.5">
                v{manifest.version}
                {isPython && (
                  <span className="px-1 py-0.5 rounded bg-muted/50 border border-border/50 text-xs">
                    Python
                  </span>
                )}
                {isUI && (
                  <span className="px-1 py-0.5 rounded bg-muted/50 border border-border/50 text-xs">
                    UI
                  </span>
                )}
              </span>
            </Field>
            {manifest.author && (
              <Field label={t("plugins.detail.author")}>
                {typeof manifest.author === "string" ? manifest.author : manifest.author.name}
              </Field>
            )}
            {manifest.homepage && (
              <Field label={t("plugins.detail.homepage")}>
                <a
                  href={manifest.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  {manifest.homepage}
                </a>
              </Field>
            )}
            <Field label={t("plugins.detail.path")}>
              <span className="font-mono text-xs">{plugin.path}</span>
            </Field>
            <p className="text-xs text-muted-foreground/80 leading-relaxed pt-1">
              {displayDescription}
            </p>
          </div>
        </Section>

        {/* Compatibility */}
        <Section title={t("plugins.detail.compatibilitySection")}>
          <div className="space-y-2 rounded-xl border border-border/30 bg-muted/5 p-3">
            <div className="flex items-center gap-2">
              {compatibility?.compatible === false ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xs font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  {t("plugins.incompatible.badge")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xs font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  {t("plugins.detail.compatible")}
                </span>
              )}
              <span className="text-xs text-muted-foreground/70">
                {t("plugins.detail.currentVersion")}: {compatibility?.current ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground/70">
                {t("plugins.detail.requirement")}:{" "}
                {compatibility?.requirement || t("plugins.detail.noRequirement")}
              </span>
            </div>
            {incompatible && compatibility?.reason && (
              <p className="text-xs text-red-500/90 leading-relaxed">{compatibility.reason}</p>
            )}
          </div>
        </Section>

        {/* Permissions */}
        <Section title={t("plugins.detail.permissionsSection")}>
          {permissions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/40 p-3 text-xs text-muted-foreground/60 text-center">
              {t("plugins.detail.noPermissions")}
            </div>
          ) : (
            <div className="space-y-2">
              {permissions.map((permission) => {
                const meta = getPermissionMeta(permission);
                const risk: PermissionRisk = meta?.risk ?? "medium";
                const surfaces = usage?.[permission];
                return (
                  <div
                    key={permission}
                    className="rounded-xl border border-border/30 bg-muted/5 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded-full text-xs font-bold",
                          RISK_STYLES[risk],
                        )}
                      >
                        {t(`plugins.permissions.risk.${risk}`)}
                      </span>
                      <span className="text-ui font-bold text-foreground/90">
                        {meta ? t(meta.labelKey) : permission}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground/50">
                        {permission}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed">
                      {meta ? t(meta.descKey) : t("plugins.detail.unknownPermission")}
                    </p>
                    {surfaces && surfaces.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-xs text-muted-foreground/60">
                          {t("plugins.detail.unlocksApis")}:
                        </span>
                        {surfaces.map((surface) => (
                          <span
                            key={surface}
                            className="px-1 py-0.5 rounded bg-muted/50 border border-border/50 text-xs font-mono text-muted-foreground/80"
                          >
                            {surface}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Runtime */}
        <Section title={t("plugins.detail.runtimeSection")}>
          <div className="space-y-2 rounded-xl border border-border/30 bg-muted/5 p-3">
            <div className="flex items-center gap-2">
              {loadResult?.status === "loaded" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 text-xs font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  {t("plugins.detail.statusLoaded")}
                </span>
              )}
              {loadResult?.status === "error" && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 text-xs font-bold">
                  <AlertTriangle className="w-3 h-3" />
                  {t("plugins.detail.statusError")}
                </span>
              )}
              {!loadResult && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/60 text-xs font-bold">
                  {t("plugins.detail.statusUnknown")}
                </span>
              )}
              {loadResult && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
                  <Clock className="w-3 h-3" />
                  {formatTime(loadResult.at)}
                </span>
              )}
            </div>
            {loadResult?.status === "error" && loadResult.error && (
              <p className="text-xs text-red-500/90 break-all leading-relaxed">
                {loadResult.error}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border/30 bg-muted/5 p-3">
            <div className="flex items-center gap-1.5 mb-2 text-xs font-bold text-muted-foreground/70">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t("plugins.detail.apiCalls")}
            </div>
            {callStats === null && !statsError ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30" />
              </div>
            ) : statsError ? (
              <p className="text-xs text-muted-foreground/60 text-center py-2">
                {t("plugins.detail.statsUnavailable")}
              </p>
            ) : (callStats ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground/60 text-center py-2">
                {t("plugins.detail.noCalls")}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground/60">
                    <th className="pb-1 font-medium">{t("plugins.detail.colApi")}</th>
                    <th className="pb-1 font-medium text-right">{t("plugins.detail.colCalls")}</th>
                    <th className="pb-1 font-medium text-right">{t("plugins.detail.colDenied")}</th>
                    <th className="pb-1 font-medium text-right">{t("plugins.detail.colLast")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(callStats ?? []).map((stat) => (
                    <tr key={stat.command} className="border-t border-border/20">
                      <td className="py-1 font-mono text-foreground/80">{stat.api_surface}</td>
                      <td className="py-1 text-right">{stat.calls}</td>
                      <td
                        className={cn(
                          "py-1 text-right",
                          stat.denied > 0 ? "text-red-500 font-bold" : "",
                        )}
                      >
                        {stat.denied}
                      </td>
                      <td className="py-1 text-right text-muted-foreground/60">
                        {formatTime(stat.last_called_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>
      </div>
    </Modal>
  );
};
