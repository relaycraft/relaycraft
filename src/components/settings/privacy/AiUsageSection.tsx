import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronRight, CircleAlert, Eraser, Info, Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { getProviderById } from "../../../lib/ai/providers";
import { cn } from "../../../lib/utils";
import { useAIStore } from "../../../stores/aiStore";
import { usePluginStore } from "../../../stores/pluginStore";
import { useUIStore } from "../../../stores/uiStore";
import type {
  AiKeyStatus,
  AiUsageRecentMeta,
  AiUsageRecord,
  AiUsageSummary,
} from "../../../types/ai";
import { Button } from "../../common/Button";
import { Tooltip } from "../../common/Tooltip";
import { SettingsRow, SettingsSection } from "../SettingsLayout";

const STATUS_DOT_STYLES: Record<string, string> = {
  success: "bg-green-500",
  error: "bg-red-500",
  aborted: "bg-amber-500",
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function lastNDays(count: number): { date: string; label: string }[] {
  const days: { date: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({
      date: localDateString(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    });
  }
  return days;
}

function resolveCallerLabel(
  caller: string,
  t: TFunction,
  plugins: { manifest: { id: string; name: string } }[],
): string {
  if (caller === "app") return t("privacy.ai.caller.app");
  if (caller === "connection_test") return t("privacy.ai.caller.test");
  if (caller.startsWith("plugin:")) {
    const id = caller.slice("plugin:".length);
    const plugin = plugins.find((p) => p.manifest.id === id);
    return plugin?.manifest.name || id;
  }
  return caller;
}

const CALLER_BAR_COLORS = ["bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500"];

function callerColorClass(index: number): string {
  return CALLER_BAR_COLORS[index % CALLER_BAR_COLORS.length];
}

interface UsageData {
  summary: AiUsageSummary | null;
  keyStatus: AiKeyStatus | null;
}

export function AiUsageSection() {
  const { t } = useTranslation();
  const aiProvider = useAIStore((state) => state.settings.provider);
  const plugins = usePluginStore((state) => state.plugins);
  const showConfirm = useUIStore((state) => state.showConfirm);

  const [usage, setUsage] = React.useState<UsageData>({ summary: null, keyStatus: null });
  const [clearing, setClearing] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<Record<string, AiUsageRecord | null>>({});
  const [detailLoading, setDetailLoading] = React.useState<Record<string, boolean>>({});

  const loadUsage = React.useCallback(() => {
    invoke<AiUsageSummary>("get_ai_usage_summary", { days: 7 })
      .then((summary) => setUsage((prev) => ({ ...prev, summary })))
      .catch(() => {});
    invoke<AiKeyStatus>("get_ai_key_status")
      .then((keyStatus) => setUsage((prev) => ({ ...prev, keyStatus })))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  const summary = usage.summary;
  const keyStatus = usage.keyStatus;
  const recent = summary?.recent ?? [];
  const daily = summary?.daily ?? [];

  const todayStr = localDateString(new Date());
  const todayTokens = daily
    .filter((b) => b.date === todayStr)
    .reduce((sum, b) => sum + b.totalTokens, 0);
  const weekTokens = daily.reduce((sum, b) => sum + b.totalTokens, 0);
  const weekRequests = daily.reduce((sum, b) => sum + b.requests, 0);
  const hasEstimated =
    daily.some((b) => b.estimatedRequests > 0) || recent.some((r) => r.estimated);

  const chartDays = React.useMemo(() => {
    const days = lastNDays(7);
    const byDate = new Map<string, { tokens: number; requests: number }>();
    for (const bucket of daily) {
      const entry = byDate.get(bucket.date) ?? { tokens: 0, requests: 0 };
      entry.tokens += bucket.totalTokens;
      entry.requests += bucket.requests;
      byDate.set(bucket.date, entry);
    }
    const maxTokens = Math.max(...days.map((d) => byDate.get(d.date)?.tokens ?? 0), 1);
    return days.map((d) => ({
      ...d,
      tokens: byDate.get(d.date)?.tokens ?? 0,
      requests: byDate.get(d.date)?.requests ?? 0,
      heightPct: Math.max(((byDate.get(d.date)?.tokens ?? 0) / maxTokens) * 100, 2),
    }));
  }, [daily]);

  const callerStats = React.useMemo(() => {
    const byCaller = new Map<string, number>();
    for (const bucket of daily) {
      byCaller.set(bucket.caller, (byCaller.get(bucket.caller) ?? 0) + bucket.totalTokens);
    }
    const total = [...byCaller.values()].reduce((sum, v) => sum + v, 0);
    return [...byCaller.entries()]
      .map(([caller, tokens]) => ({
        caller,
        tokens,
        pct: total > 0 ? (tokens / total) * 100 : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .map((stat, index) => ({ ...stat, colorClass: callerColorClass(index) }));
  }, [daily]);

  const toggleDetail = (record: AiUsageRecentMeta) => {
    if (expandedId === record.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(record.id);
    if (details[record.id] !== undefined || detailLoading[record.id]) return;
    setDetailLoading((prev) => ({ ...prev, [record.id]: true }));
    invoke<AiUsageRecord>("get_ai_request_detail", { id: record.id })
      .then((detail) => setDetails((prev) => ({ ...prev, [record.id]: detail })))
      .catch(() => setDetails((prev) => ({ ...prev, [record.id]: null })))
      .finally(() => setDetailLoading((prev) => ({ ...prev, [record.id]: false })));
  };

  const handleClear = () => {
    showConfirm({
      title: t("privacy.ai.clear_confirm_title"),
      message: t("privacy.ai.clear_confirm_msg"),
      variant: "warning",
      confirmLabel: t("privacy.ai.clear"),
      onConfirm: () => {
        setClearing(true);
        invoke("clear_ai_usage")
          .then(() => {
            setUsage({ summary: null, keyStatus: null });
            setDetails({});
            setExpandedId(null);
            loadUsage();
          })
          .catch(() => {})
          .finally(() => setClearing(false));
      },
    });
  };

  const providerLabel =
    getProviderById(keyStatus?.provider || aiProvider)?.description ||
    keyStatus?.provider ||
    aiProvider;

  return (
    <SettingsSection
      title={t("privacy.ai.title")}
      action={
        daily.length > 0 || recent.length > 0 ? (
          <Button
            variant="ghost"
            size="xs"
            className="h-6 px-2 gap-1 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Eraser className="w-3 h-3" />
            )}
            {t("privacy.ai.clear")}
          </Button>
        ) : undefined
      }
    >
      {/* Key row */}
      <SettingsRow
        title={providerLabel}
        description={
          <span className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1.5">
              {keyStatus?.hasKey ? (
                <code className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">
                  {keyStatus.masked}
                </code>
              ) : (
                <span className="text-muted-foreground/60">{t("privacy.ai.no_key")}</span>
              )}
              <span className="px-1.5 py-0.5 rounded-full bg-muted text-tiny font-bold text-muted-foreground">
                {t("privacy.ai.key_storage_badge")}
              </span>
            </span>
            <span>{t("privacy.ai.key_desc")}</span>
          </span>
        }
      />

      {/* Stats chips */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border/40 text-xs">
          <span className="text-muted-foreground">{t("privacy.ai.today_tokens")}</span>
          <span className="font-mono font-bold text-foreground">{formatTokens(todayTokens)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border/40 text-xs">
          <span className="text-muted-foreground">{t("privacy.ai.week_tokens")}</span>
          <span className="font-mono font-bold text-foreground">{formatTokens(weekTokens)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border/40 text-xs">
          <span className="text-muted-foreground">{t("privacy.ai.week_requests")}</span>
          <span className="font-mono font-bold text-foreground">{weekRequests}</span>
        </span>
        {hasEstimated && (
          <Tooltip content={t("privacy.ai.estimated_tooltip")} side="bottom">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 cursor-default">
              <Info className="w-3 h-3" />
              {t("privacy.ai.estimated_note")}
            </span>
          </Tooltip>
        )}
      </div>

      {/* 7-day chart */}
      {weekRequests > 0 && (
        <div className="px-4 py-3 border-t border-border/30">
          <div className="flex items-end gap-1.5 h-24">
            {chartDays.map((day) => (
              <div
                key={day.date}
                className="flex-1 h-full flex flex-col items-center justify-end gap-1 group"
                title={t("privacy.ai.chart_day", {
                  date: day.label,
                  tokens: formatTokens(day.tokens),
                  requests: day.requests,
                })}
              >
                <motion.div
                  className={cn(
                    "w-full rounded-t-sm",
                    day.tokens > 0 ? "bg-primary/70 group-hover:bg-primary" : "bg-muted/40",
                  )}
                  initial={{ height: 0 }}
                  animate={{ height: `${day.heightPct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
                <span className="text-tiny text-muted-foreground/50">{day.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Caller breakdown */}
      {callerStats.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
            {t("privacy.ai.caller_title")}
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-muted/40">
            {callerStats.map((stat) => (
              <div
                key={stat.caller}
                className={stat.colorClass}
                style={{ width: `${stat.pct}%` }}
                title={`${resolveCallerLabel(stat.caller, t, plugins)}: ${formatTokens(stat.tokens)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {callerStats.map((stat) => (
              <span
                key={stat.caller}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className={cn("w-2 h-2 rounded-full", stat.colorClass)} />
                {resolveCallerLabel(stat.caller, t, plugins)}
                <span className="font-mono text-foreground/80">{formatTokens(stat.tokens)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent requests */}
      <div className="border-t border-border/30">
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
              {t("privacy.ai.recent_title")}
            </div>
            <div className="text-tiny text-muted-foreground/50 mt-0.5">
              {t("privacy.ai.recent_desc")}
            </div>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="px-4 pb-4 text-xs text-muted-foreground/60 text-center py-4">
            {summary ? t("privacy.ai.recent_empty") : t("common.loading")}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {recent.map((record) => {
              const expanded = expandedId === record.id;
              const detail = details[record.id];
              const loadingDetail = detailLoading[record.id];
              return (
                <div key={record.id}>
                  <button
                    type="button"
                    onClick={() => toggleDetail(record)}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                  >
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                    )}
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        STATUS_DOT_STYLES[record.status] ?? "bg-muted-foreground/40",
                      )}
                    />
                    <span className="text-xs text-muted-foreground/70 font-mono shrink-0">
                      {new Date(record.timestampMs).toLocaleTimeString()}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-muted/60 text-tiny font-semibold text-foreground/80 shrink-0 max-w-32 truncate">
                      {resolveCallerLabel(record.caller, t, plugins)}
                    </span>
                    <span className="text-xs font-mono text-foreground/80 truncate flex-1 min-w-0">
                      {record.model}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {record.estimated ? "~" : ""}
                      {formatTokens(record.totalTokens)}
                    </span>
                    <span className="text-tiny text-muted-foreground/50 shrink-0 w-14 text-right">
                      {record.durationMs}ms
                    </span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-3 pt-1 pl-11 space-y-2">
                      {loadingDetail || detail === undefined ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 py-2">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t("common.loading")}
                        </div>
                      ) : detail === null ? (
                        <div className="text-xs text-muted-foreground/60 py-2">
                          {t("privacy.ai.detail_unavailable")}
                        </div>
                      ) : (
                        <>
                          {detail.messages.map((message, index) => (
                            <div
                              key={index}
                              className="rounded-lg border border-border/30 bg-muted/20 overflow-hidden"
                            >
                              <div className="px-2.5 py-1.5 flex items-center gap-2 border-b border-border/20 bg-muted/30">
                                <span className="px-1.5 py-0.5 rounded bg-background/60 text-tiny font-bold text-foreground/80 uppercase">
                                  {message.role}
                                </span>
                                <span className="text-tiny text-muted-foreground/60">
                                  {t("privacy.ai.msg_chars", {
                                    count: message.originalChars.toLocaleString(),
                                  })}
                                </span>
                                {message.truncated && (
                                  <span className="text-tiny text-amber-600 dark:text-amber-400 font-semibold">
                                    {t("privacy.ai.msg_truncated")}
                                  </span>
                                )}
                              </div>
                              <pre className="px-2.5 py-2 text-xs font-mono text-foreground/80 whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
                                {message.content}
                              </pre>
                            </div>
                          ))}
                          {detail.error && (
                            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2">
                              <CircleAlert className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                              <span className="text-xs text-red-600 dark:text-red-400 break-all">
                                {detail.error}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
