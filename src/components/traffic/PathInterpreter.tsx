import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PathMetadata } from "@/types/flow";

function StepCircle({
  label,
  stepLabel,
  active,
}: {
  label: string;
  stepLabel: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {label}
      </div>
      <span
        className={cn(
          "text-sm font-semibold",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {stepLabel}
      </span>
    </div>
  );
}

interface PathInterpreterProps {
  data?: PathMetadata | null;
}

export function PathInterpreter({ data }: PathInterpreterProps) {
  const { t } = useTranslation();

  if (!data) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">{t("flow.path.legacy")}</div>
    );
  }

  const rules = data.rules_applied ?? [];
  const hasRewrite = rules.length > 0;
  const isEntryGateway = data.entry === "gateway";
  const viaUpstream = data.outbound?.via_upstream_proxy ?? false;
  const proxyUrl = data.outbound?.proxy_url;
  const outcomeKey = `flow.path.outcome_${data.outcome}` as const;

  const steps = [
    { key: "entry", label: "1", stepLabel: t("flow.path.entry"), active: true },
    {
      key: "rewrite",
      label: "2",
      stepLabel: t("flow.path.rewrite"),
      active: hasRewrite,
    },
    {
      key: "intercept",
      label: "3",
      stepLabel: t("flow.path.intercept"),
      active: data.outcome === "breakpoint",
    },
    {
      key: "outbound",
      label: "4",
      stepLabel: t("flow.path.outbound"),
      active:
        data.outcome !== "blocked" && data.outcome !== "mapped_local" && data.outcome !== "mocked",
    },
    {
      key: "outcome",
      label: "5",
      stepLabel: t("flow.path.outcome"),
      active: true,
    },
  ];

  return (
    <div className="p-4 space-y-5 overflow-y-auto">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        {t("flow.path.title")}
      </p>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={step.key}>
            <StepCircle label={step.label} stepLabel={step.stepLabel} active={step.active} />
            <div className="ml-4 pl-11 mt-1 space-y-1">
              {step.key === "entry" && (
                <p className="text-xs text-muted-foreground">
                  {isEntryGateway ? t("flow.path.entry_gateway") : t("flow.path.entry_forward")}
                </p>
              )}
              {step.key === "rewrite" &&
                (hasRewrite ? (
                  <ul className="space-y-1">
                    {rules.map((r, j) => (
                      <li key={j} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{r.name}</span> &middot;{" "}
                        <span className="lowercase">{r.type}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("flow.path.rewrite_none")}</p>
                ))}
              {step.key === "intercept" &&
                (data.outcome === "breakpoint" ? (
                  <p className="text-xs text-muted-foreground">
                    {t("flow.path.outcome_breakpoint")}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("flow.path.intercept_none")}</p>
                ))}
              {step.key === "outbound" &&
                (viaUpstream ? (
                  <p className="text-xs text-muted-foreground">
                    {t("flow.path.outbound_via", {
                      proxy: proxyUrl ?? "?",
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("flow.path.outbound_direct")}</p>
                ))}
              {step.key === "outcome" && (
                <p
                  className={cn(
                    "text-xs font-semibold",
                    data.outcome === "error" ? "text-destructive" : "text-primary",
                  )}
                >
                  {t(outcomeKey, data.outcome)}
                </p>
              )}
            </div>
            {i < steps.length - 1 && step.active && steps[i + 1].active && (
              <div className="ml-[15px] w-px h-2 bg-border" />
            )}
          </div>
        ))}
      </div>

      {rules.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {rules.map((r, j) => (
              <span key={j}>
                {r.type}: {r.id}
                {j < rules.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
