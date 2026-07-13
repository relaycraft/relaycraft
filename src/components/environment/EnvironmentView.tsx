import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "../../hooks/useNavigate";
import { cn } from "../../lib/utils";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { Rule } from "../../types";

function countEnabledRules(rules: Rule[]): number {
  return rules.filter((r) => r.execution?.enabled !== false).length;
}

function countRuleTypes(rules: Rule[]): { mapLocal: number; mapRemote: number; other: number } {
  let mapLocal = 0;
  let mapRemote = 0;
  let other = 0;
  for (const rule of rules) {
    if (rule.execution?.enabled === false) continue;
    if (rule.type === "map_local") mapLocal += 1;
    else if (rule.type === "map_remote") mapRemote += 1;
    else other += 1;
  }
  return { mapLocal, mapRemote, other };
}

export function EnvironmentView() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const running = useProxyStore((s) => s.running);
  const active = useProxyStore((s) => s.active);
  const proxyPort = useProxyStore((s) => s.port);
  const config = useSettingsStore((s) => s.config);
  const rules = useRuleStore((s) => s.rules);
  const groups = useRuleStore((s) => s.groups);

  const gateway = config.gateway ?? {
    enabled: false,
    port: 9080,
    active_profile: "default",
    listen_lan: false,
  };
  const upstreamEnabled = config.upstream_proxy?.enabled ?? false;
  const upstreamUrl = config.upstream_proxy?.url ?? "";
  const enabledCount = countEnabledRules(rules);
  const actionCounts = useMemo(() => countRuleTypes(rules), [rules]);

  const forwardListening = running && active;

  return (
    <div className="h-full flex flex-col p-6 gap-6 bg-background overflow-y-auto">
      <div>
        <h2 className="text-base font-bold tracking-tight text-foreground/90">
          {t("sidebar.environment")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1">{t("environment.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Entry */}
        <button
          type="button"
          onClick={() => navigate(gateway.enabled ? "gateway" : "settings")}
          className={cn(
            "text-left rounded-xl border border-border/50 bg-card/30 p-4 space-y-3",
            "hover:border-border hover:bg-card/50 transition-colors",
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.entry")}
          </span>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  forwardListening ? "bg-green-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="font-semibold">{t("flow.path.entry_forward")}</span>
              <span className="text-muted-foreground font-mono">:{proxyPort}</span>
            </div>
            <p className="text-[11px] text-muted-foreground pl-4">
              {running
                ? active
                  ? t("environment.forward_capturing")
                  : t("environment.forward_idle")
                : t("environment.forward_stopped")}
            </p>
            {gateway.enabled ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="font-semibold">{t("flow.path.entry_gateway")}</span>
                <span className="text-muted-foreground font-mono">:{gateway.port}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground/50">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                <span className="italic text-xs">{t("environment.gateway_off")}</span>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {t("environment.click_hint_entry")}
          </p>
        </button>

        {/* Rewrite / Intercept */}
        <button
          type="button"
          onClick={() => navigate("rules")}
          className={cn(
            "text-left rounded-xl border border-border/50 bg-card/30 p-4 space-y-3",
            "hover:border-border hover:bg-card/50 transition-colors",
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.rewrite")}
          </span>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-semibold">{enabledCount}</span>{" "}
              <span className="text-muted-foreground">{t("environment.rules_enabled")}</span>
              {groups.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {t("environment.groups_count", { count: groups.length })}
                </span>
              )}
            </div>
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              <li>
                {t("environment.map_local")}:{" "}
                <span className="font-mono text-foreground/80">{actionCounts.mapLocal}</span>
              </li>
              <li>
                {t("environment.map_remote")}:{" "}
                <span className="font-mono text-foreground/80">{actionCounts.mapRemote}</span>
              </li>
              <li>
                {t("environment.other_actions")}:{" "}
                <span className="font-mono text-foreground/80">{actionCounts.other}</span>
              </li>
            </ul>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {t("environment.click_hint_rules")}
          </p>
        </button>

        {/* Outbound */}
        <button
          type="button"
          onClick={() => navigate("settings")}
          className={cn(
            "text-left rounded-xl border border-border/50 bg-card/30 p-4 space-y-3",
            "hover:border-border hover:bg-card/50 transition-colors",
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t("flow.path.outbound")}
          </span>
          <div className="space-y-2 text-sm">
            {upstreamEnabled && upstreamUrl ? (
              <div className="font-semibold break-all">
                {t("flow.path.outbound_via", { proxy: upstreamUrl })}
              </div>
            ) : (
              <div className="font-semibold">{t("flow.path.outbound_direct")}</div>
            )}
            {gateway.enabled && (
              <p className="text-[11px] text-muted-foreground">
                {t("environment.gateway_profile", { profile: gateway.active_profile })}
              </p>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {t("environment.click_hint_outbound")}
          </p>
        </button>
      </div>
    </div>
  );
}
