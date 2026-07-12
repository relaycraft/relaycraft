import { motion } from "framer-motion";
import {
  Activity,
  Ban,
  CheckCircle2,
  FileEdit,
  FileJson,
  Flag,
  LogIn,
  Network,
  PauseCircle,
  Send,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Flow } from "@/types/flow";

interface PathInterpreterProps {
  flow?: Flow | null;
}

export function PathInterpreter({ flow }: PathInterpreterProps) {
  const { t } = useTranslation();
  const data = flow?._rc?.relaycraftPath;

  if (!data) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-muted-foreground h-full bg-background relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:14px_14px]" />
        <Network className="w-12 h-12 mb-4 opacity-10" />
        <span className="text-sm font-mono tracking-widest uppercase opacity-50">
          {t("flow.path.legacy")}
        </span>
      </div>
    );
  }

  const rules = data.rules_applied ?? [];
  const hasRewrite = rules.length > 0;
  const isEntryGateway = data.entry === "gateway";
  const viaUpstream = data.outbound?.via_upstream_proxy ?? false;
  const proxyUrl = data.outbound?.proxy_url;
  const outcomeKey = `flow.path.outcome_${data.outcome}` as const;

  let OutcomeIcon = Flag;
  let outcomeColor =
    "text-cyan-400 border-cyan-500/50 bg-cyan-950/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]";
  if (data.outcome === "error" || data.outcome === "blocked") {
    OutcomeIcon = data.outcome === "error" ? XCircle : Ban;
    outcomeColor =
      "text-rose-400 border-rose-500/50 bg-rose-950/20 shadow-[0_0_10px_rgba(244,63,94,0.2)]";
  } else if (data.outcome === "mapped_local" || data.outcome === "mocked") {
    OutcomeIcon = FileJson;
    outcomeColor =
      "text-amber-400 border-amber-500/50 bg-amber-950/20 shadow-[0_0_10px_rgba(251,191,36,0.2)]";
  } else if (data.outcome === "breakpoint") {
    OutcomeIcon = PauseCircle;
    outcomeColor =
      "text-blue-400 border-blue-500/50 bg-blue-950/20 shadow-[0_0_10px_rgba(96,165,250,0.2)]";
  } else {
    OutcomeIcon = CheckCircle2;
    outcomeColor =
      "text-emerald-400 border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_10px_rgba(52,211,153,0.2)]";
  }

  const steps = [
    {
      key: "entry",
      icon: LogIn,
      label: t("flow.path.entry"),
      active: true,
      color:
        "text-cyan-400 border-cyan-500/50 bg-cyan-950/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]",
      content: isEntryGateway ? t("flow.path.entry_gateway") : t("flow.path.entry_forward"),
      detail: `NODE_TYPE="${data.entry.toUpperCase()}"`,
      extraMetrics: flow?._rc?.clientIp ? `CLIENT_IP="${flow._rc.clientIp}"` : null,
    },
    {
      key: "rewrite",
      icon: FileEdit,
      label: t("flow.path.rewrite"),
      active: hasRewrite,
      color: hasRewrite
        ? "text-amber-400 border-amber-500/50 bg-amber-950/20 shadow-[0_0_10px_rgba(251,191,36,0.2)]"
        : "text-muted-foreground/50 border-border/50 bg-muted/10",
      content: hasRewrite ? null : t("flow.path.rewrite_none"),
      rules: rules,
    },
    {
      key: "intercept",
      icon: ShieldAlert,
      label: t("flow.path.intercept"),
      active: data.outcome === "breakpoint",
      color:
        data.outcome === "breakpoint"
          ? "text-blue-400 border-blue-500/50 bg-blue-950/20 shadow-[0_0_10px_rgba(96,165,250,0.2)]"
          : "text-muted-foreground/50 border-border/50 bg-muted/10",
      content:
        data.outcome === "breakpoint"
          ? t("flow.path.outcome_breakpoint")
          : t("flow.path.intercept_none"),
    },
    {
      key: "outbound",
      icon: Send,
      label: t("flow.path.outbound"),
      active:
        data.outcome !== "blocked" && data.outcome !== "mapped_local" && data.outcome !== "mocked",
      color:
        data.outcome !== "blocked" && data.outcome !== "mapped_local" && data.outcome !== "mocked"
          ? "text-indigo-400 border-indigo-500/50 bg-indigo-950/20 shadow-[0_0_10px_rgba(129,140,248,0.2)]"
          : "text-muted-foreground/50 border-border/50 bg-muted/10",
      content: viaUpstream
        ? t("flow.path.outbound_via", { proxy: proxyUrl ?? "?" })
        : t("flow.path.outbound_direct"),
      detail: viaUpstream ? `PROXY_UPSTREAM="${proxyUrl}"` : `CONNECTION="DIRECT"`,
      extraMetrics: flow?._rc?.serverIp ? `SERVER_IP="${flow._rc.serverIp}"` : null,
    },
    {
      key: "outcome",
      icon: OutcomeIcon,
      label: t("flow.path.outcome"),
      active: true,
      color: outcomeColor,
      content: t(outcomeKey, data.outcome),
      detail: `EXIT_CODE="${data.outcome.toUpperCase()}"`,
      extraMetrics: flow?.time ? `LATENCY="${flow.time}ms"` : null,
      statusMetric: flow?.response?.status ? `STATUS=${flow.response.status}` : null,
    },
  ];

  const containerVariants: any = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants: any = {
    hidden: { opacity: 0, x: -15 },
    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
  };

  return (
    <div className="relative h-full bg-background overflow-hidden flex flex-col font-mono selection:bg-primary/30">
      {/* HUD Backgrounds */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent opacity-30 pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-primary">
          <Activity className="w-3.5 h-3.5" />
          <span className="uppercase tracking-widest font-bold text-[11px]">PIPELINE_TRACE</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[9px] font-bold tracking-widest text-primary">COMPLETED</span>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto p-4">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="relative ml-2 max-w-full"
        >
          {/* Main vertical track line */}
          <div className="absolute left-[11px] top-4 bottom-4 w-[2px] bg-border/40 rounded-full" />

          <div className="space-y-4">
            {steps.map((step, i) => {
              const Icon = step.icon;
              const isActive = step.active;

              return (
                <motion.div
                  key={step.key}
                  variants={itemVariants}
                  className={cn("relative flex gap-4", !isActive && "opacity-60 grayscale-[50%]")}
                >
                  {/* Node */}
                  <div
                    className={cn(
                      "relative z-10 flex items-center justify-center w-6 h-6 rounded border shrink-0 transition-colors duration-500",
                      step.color,
                    )}
                  >
                    <Icon className="w-3 h-3" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span
                        className={cn(
                          "font-bold text-xs tracking-tight uppercase",
                          isActive ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {step.label}
                      </span>
                      {isActive && (
                        <span className="text-[9px] px-1 py-0.5 rounded border border-primary/20 bg-primary/10 text-primary font-mono opacity-80">
                          {`OP_0${i + 1}`}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] space-y-1.5">
                      {step.rules && step.rules.length > 0 ? (
                        <div className="space-y-1.5 mt-1.5">
                          {step.rules.map((r: any, j: number) => (
                            <div
                              key={j}
                              className="group flex flex-col gap-1 bg-black/20 hover:bg-black/40 p-2 rounded border border-border/50 transition-colors relative overflow-hidden"
                            >
                              <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-500/50 group-hover:bg-amber-400 transition-colors" />
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-amber-100/90 text-[11px] tracking-wide">
                                  {r.name}
                                </span>
                                <span className="text-[8px] uppercase bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded border border-amber-500/30">
                                  {r.type}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70 truncate">
                                <Terminal className="w-2.5 h-2.5" />
                                <span className="truncate">{r.id}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p
                          className={cn(
                            "leading-relaxed font-sans",
                            isActive ? "text-muted-foreground" : "text-muted-foreground/50",
                          )}
                        >
                          {step.content}
                        </p>
                      )}

                      {isActive && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/40 text-[9px] font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                          {step.detail && (
                            <div className="text-primary/70 flex items-center gap-1.5">
                              <span>{">"}</span>
                              <span className="opacity-80">{step.detail}</span>
                            </div>
                          )}
                          {step.extraMetrics && (
                            <div className="text-muted-foreground flex items-center gap-1.5">
                              <span className="text-border">|</span>
                              <span className="text-amber-500/80">{step.extraMetrics}</span>
                            </div>
                          )}
                          {step.statusMetric && (
                            <div className="text-muted-foreground flex items-center gap-1.5">
                              <span className="text-border">|</span>
                              <span
                                className={cn(
                                  "font-bold",
                                  flow?.response?.status && flow.response.status >= 400
                                    ? "text-rose-400"
                                    : "text-emerald-400",
                                )}
                              >
                                {step.statusMetric}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
