import { ArrowDown, ArrowUpFromDot, Filter, Server, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrafficPathModel } from "../../lib/traffic/trafficPath";
import { cn } from "../../lib/utils";

function StateDot({ tone, label }: { tone: "ok" | "idle" | "off"; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full",
          tone === "ok" && "bg-success",
          tone === "idle" && "bg-amber-500",
          tone === "off" && "bg-muted-foreground/40",
        )}
      />
      {label}
    </span>
  );
}

function SectionLabel({ icon: Icon, text }: { icon: typeof Server; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
      <Icon className="w-3 h-3" />
      {text}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <ArrowDown className="w-3 h-3 text-muted-foreground/40" />
    </div>
  );
}

export function TrafficPathPanel({ model }: { model: TrafficPathModel }) {
  const { t } = useTranslation();

  const forwardTone = !model.forward.running ? "off" : model.forward.active ? "ok" : "idle";
  const forwardLabel = !model.forward.running
    ? t("status_bar.tp_state_stopped")
    : model.forward.active
      ? t("status_bar.tp_state_running")
      : t("status_bar.tp_state_paused");

  return (
    <div className="w-[320px] p-4 flex flex-col gap-2.5">
      <div className="text-sm font-semibold">{t("status_bar.traffic_path")}</div>

      {/* Entries */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel icon={Server} text={t("status_bar.tp_entry")} />
        <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">{t("status_bar.tp_forward")}</div>
            <div className="text-[11px] font-mono text-muted-foreground">
              127.0.0.1:{model.forward.port}
            </div>
          </div>
          <StateDot tone={forwardTone} label={forwardLabel} />
        </div>
        {model.share && (
          <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium flex items-center gap-1">
                <Share2 className="w-3 h-3" />
                {t("status_bar.tp_share")}
              </div>
              <div className="text-[11px] font-mono text-muted-foreground truncate">
                :{model.share.port} → {model.share.upstreamUrl}
              </div>
            </div>
            <StateDot
              tone={model.forward.running ? "ok" : "off"}
              label={
                model.forward.running
                  ? t("status_bar.tp_state_running")
                  : t("status_bar.tp_state_stopped")
              }
            />
          </div>
        )}
      </div>

      <FlowArrow />

      {/* Rules */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel icon={Filter} text={t("status_bar.tp_rules")} />
        <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
          {model.enabledRuleCount === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              {t("status_bar.tp_rules_empty")}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {model.ruleStats.map((stat) => (
                <span
                  key={stat.action}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 text-primary px-1.5 py-0.5 text-[11px] font-medium"
                >
                  {t(`status_bar.tp_action_${stat.action}`)}
                  <span className="font-mono">{stat.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <FlowArrow />

      {/* Egress */}
      <div className="flex flex-col gap-1.5">
        <SectionLabel icon={ArrowUpFromDot} text={t("status_bar.tp_egress")} />
        <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
          <div className="text-xs font-medium">
            {model.egress.type === "upstream"
              ? t("status_bar.tp_egress_upstream")
              : t("status_bar.tp_egress_direct")}
          </div>
          {model.egress.url && (
            <div className="text-[11px] font-mono text-muted-foreground truncate">
              {model.egress.url}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
