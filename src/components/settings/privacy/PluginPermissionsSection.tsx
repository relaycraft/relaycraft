import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { getPluginCallStats, type PluginCallStat } from "../../../plugins/callStats";
import { getPermissionMeta, type PermissionRisk } from "../../../plugins/permissions";
import { usePluginStore } from "../../../stores/pluginStore";
import { SettingsSection } from "../SettingsLayout";

const RISK_CHIP_STYLES: Record<PermissionRisk, string> = {
  low: "bg-green-500/10 text-green-600 dark:text-green-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export function PluginPermissionsSection() {
  const { t } = useTranslation();
  const plugins = usePluginStore((state) => state.plugins);
  const [callStats, setCallStats] = React.useState<PluginCallStat[] | null>(null);

  React.useEffect(() => {
    let active = true;
    getPluginCallStats()
      .then((stats) => {
        if (active) setCallStats(stats);
      })
      .catch(() => {
        if (active) setCallStats([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const sensitivePlugins = plugins.filter(
    (plugin) =>
      plugin.enabled &&
      (plugin.manifest.permissions ?? []).some((permission) => {
        const risk = getPermissionMeta(permission)?.risk;
        return risk === "medium" || risk === "high";
      }),
  );

  const statsByPlugin = React.useMemo(() => {
    const map = new Map<string, { calls: number; denied: number }>();
    for (const stat of callStats ?? []) {
      const entry = map.get(stat.plugin_id) ?? { calls: 0, denied: 0 };
      entry.calls += stat.calls;
      entry.denied += stat.denied;
      map.set(stat.plugin_id, entry);
    }
    return map;
  }, [callStats]);

  return (
    <SettingsSection title={t("privacy.plugins.title")}>
      <div className="px-4 py-3">
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          {t("privacy.plugins.desc")}
        </p>
      </div>
      {sensitivePlugins.length === 0 ? (
        <div className="px-4 pb-4 text-xs text-muted-foreground/60 text-center py-3">
          {t("privacy.plugins.empty")}
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {sensitivePlugins.map((plugin) => {
            const sensitivePermissions = (plugin.manifest.permissions ?? []).filter(
              (permission) => {
                const risk = getPermissionMeta(permission)?.risk;
                return risk === "medium" || risk === "high";
              },
            );
            const stats = statsByPlugin.get(plugin.manifest.id);
            return (
              <div key={plugin.manifest.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ui font-semibold text-foreground truncate">
                    {plugin.manifest.name}
                  </span>
                  {stats && (
                    <span className="shrink-0 text-tiny text-muted-foreground/70">
                      {t("privacy.plugins.calls", { count: stats.calls })}
                      {stats.denied > 0 && (
                        <span className="ml-2 text-red-500 font-bold">
                          {t("privacy.plugins.denied", { count: stats.denied })}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sensitivePermissions.map((permission) => {
                    const meta = getPermissionMeta(permission);
                    const risk: PermissionRisk = meta?.risk ?? "medium";
                    return (
                      <span
                        key={permission}
                        className={cn(
                          "px-1.5 py-0.5 rounded-full text-tiny font-bold",
                          RISK_CHIP_STYLES[risk],
                        )}
                      >
                        {meta ? t(meta.labelKey) : permission}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sensitivePlugins.length > 0 && (
        <div className="px-4 pb-3">
          <span className="text-tiny text-muted-foreground/50">
            {t("privacy.plugins.session_note")}
          </span>
        </div>
      )}
    </SettingsSection>
  );
}
