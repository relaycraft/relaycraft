import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Rule } from "../../types";

function countEnabledRules(rules: Rule[]): number {
  return rules.filter((r) => r.execution?.enabled !== false).length;
}

export function EnvironmentView() {
  const { t } = useTranslation();
  const running = useProxyStore((s) => s.running);
  const proxyPort = useProxyStore((s) => s.port);
  const config = useSettingsStore((s) => s.config);
  const rules = useRuleStore((s) => s.rules);
  const groups = useRuleStore((s) => s.groups);

  const gatewayEnabled = config.gateway?.enabled ?? false;
  const gatewayPort = config.gateway?.port ?? 9080;
  const upstreamEnabled = config.upstream_proxy?.enabled ?? false;
  const upstreamUrl = config.upstream_proxy?.url ?? "";
  const enabledCount = countEnabledRules(rules);

  return (
    <div className="h-full flex flex-col p-6 gap-6 bg-background">
      <h2 className="text-base font-bold tracking-tight text-foreground/90">
        {t("sidebar.environment")}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Entry */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.entry")}
          </span>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-muted-foreground/40"}`}
              />
              <span className="font-semibold">{t("flow.path.entry_forward")}</span>
              <span className="text-muted-foreground font-mono">:{proxyPort}</span>
            </div>
            {gatewayEnabled ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="font-semibold">{t("flow.path.entry_gateway")}</span>
                <span className="text-muted-foreground font-mono">:{gatewayPort}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground/50">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                <span className="italic text-xs">{t("flow.path.entry_gateway")} —</span>
              </div>
            )}
          </div>
        </div>

        {/* Rewrite / Intercept */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.rewrite")}
          </span>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-semibold">{enabledCount}</span>{" "}
              <span className="text-muted-foreground">{t("sidebar.rules").toLowerCase()}</span>
              {groups.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  / {groups.length} {groups.length === 1 ? "group" : "groups"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Outbound */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-4 space-y-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.outbound")}
          </span>
          <div className="space-y-2 text-sm">
            {upstreamEnabled && upstreamUrl ? (
              <div className="font-semibold">
                {t("flow.path.outbound_via", { proxy: upstreamUrl })}
              </div>
            ) : (
              <div className="font-semibold">{t("flow.path.outbound_direct")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
