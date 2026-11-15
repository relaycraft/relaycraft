import { invoke } from "@tauri-apps/api/core";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronRight, History, RefreshCw, Search } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { usePluginStore } from "../../../stores/pluginStore";
import type { AuditLogEntry } from "../../../types/audit";
import { Button } from "../../common/Button";
import { SettingsSection } from "../SettingsLayout";

const ACTOR_FILTERS = ["all", "user", "plugin", "mcp", "ai", "system"] as const;
type ActorFilter = (typeof ACTOR_FILTERS)[number];

const RESULT_DOT_STYLES: Record<string, string> = {
  ok: "bg-green-500",
  denied: "bg-amber-500",
  error: "bg-red-500",
  aborted: "bg-amber-500",
};

/** Actions with dedicated i18n labels; anything else falls back to raw. */
const KNOWN_ACTIONS = new Set([
  "config.update",
  "plugin.install",
  "plugin.uninstall",
  "plugin.toggle",
  "plugin.enable_refused",
  "plugin.call",
  "theme.install",
  "theme.uninstall",
  "cert.install",
  "cert.remove",
  "cert.regenerate",
  "session.save",
  "har.export",
  "script.save",
  "script.delete",
  "script.toggle",
  "script.rename",
  "ai.key.update",
  "ai.key.delete",
  "ai.usage.clear",
  "ai.request",
  "rules.save",
  "rules.delete",
  "rules.import",
  "rules.groups.save",
  "snapshot.export",
  "snapshot.import",
  "snapshot.import.denied",
  "note",
]);

function actionLabel(action: string | undefined, t: TFunction): string {
  if (!action) return "—";
  if (action.startsWith("mcp.")) {
    return t("privacy.audit.action_mcp", { tool: action.slice(4) });
  }
  if (KNOWN_ACTIONS.has(action)) {
    return t(`privacy.audit.actions.${action}`);
  }
  return action;
}

function formatTime(ts: string | undefined): string {
  if (!ts) return "";
  // RFC3339 local ("2025-01-02T03:04:05+08:00") and legacy
  // ("2025-01-02 03:04:05") both render as "YYYY-MM-DD HH:MM:SS…".
  return ts.replace("T", " ");
}

function metaValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function AuditLogSection() {
  const { t } = useTranslation();
  const plugins = usePluginStore((state) => state.plugins);

  const [actorFilter, setActorFilter] = React.useState<ActorFilter>("all");
  const [searchInput, setSearchInput] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [events, setEvents] = React.useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadEvents = React.useCallback(() => {
    setLoading(true);
    invoke<AuditLogEntry[]>("get_audit_events", {
      limit: 200,
      actor: actorFilter === "all" ? undefined : actorFilter,
      query: debouncedQuery || undefined,
    })
      .then((data) => setEvents(Array.isArray(data) ? data : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [actorFilter, debouncedQuery]);

  React.useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const resolveActorName = (entry: AuditLogEntry): string | undefined => {
    if (entry.actor === "plugin" && entry.actorId) {
      const plugin = plugins.find((p) => p.manifest.id === entry.actorId);
      return plugin?.manifest.name ?? entry.actorName ?? entry.actorId;
    }
    // mcp rows show the client name; other actors fall back to id/name.
    return entry.actorName ?? entry.actorId;
  };

  const renderRow = (entry: AuditLogEntry, index: number) => {
    const key = `${entry.ts ?? ""}-${index}`;
    const expanded = expandedKey === key;

    if (entry.legacy) {
      return (
        <div key={key} className="px-4 py-2.5">
          <div className="flex items-start gap-2">
            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-muted text-tiny font-bold text-muted-foreground">
              {t("privacy.audit.legacy_badge")}
            </span>
            <span className="flex-1 text-xs font-mono text-muted-foreground break-all whitespace-pre-wrap">
              {entry.raw}
            </span>
          </div>
        </div>
      );
    }

    const actorName = resolveActorName(entry);
    const metaEntries = entry.meta ? Object.entries(entry.meta) : [];
    const hasDetail = !!entry.detail || metaEntries.length > 0;

    return (
      <div key={key} className="px-4 py-2.5">
        <button
          type="button"
          onClick={() => hasDetail && setExpandedKey(expanded ? null : key)}
          className={cn(
            "w-full flex items-center gap-2.5 text-left",
            hasDetail && "cursor-pointer",
          )}
        >
          <span className="shrink-0 text-tiny font-mono text-muted-foreground/60 w-[150px]">
            {formatTime(entry.ts)}
          </span>
          <span
            className={cn(
              "shrink-0 px-1.5 py-0.5 rounded-full text-tiny font-bold",
              entry.actor === "plugin" && "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              entry.actor === "mcp" && "bg-sky-500/10 text-sky-600 dark:text-sky-400",
              entry.actor === "ai" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              entry.actor === "system" && "bg-muted text-muted-foreground",
              (!entry.actor || entry.actor === "user") &&
                "bg-blue-500/10 text-blue-600 dark:text-blue-400",
            )}
          >
            {entry.actor
              ? t(`privacy.audit.actor.${entry.actor}`)
              : t("privacy.audit.actor.system")}
            {actorName ? ` · ${actorName}` : ""}
          </span>
          <span className="shrink-0 text-xs font-semibold text-foreground">
            {actionLabel(entry.action, t)}
          </span>
          {entry.target && (
            <code className="hidden sm:inline shrink-0 max-w-[220px] truncate text-tiny font-mono text-muted-foreground/80">
              {entry.target}
            </code>
          )}
          <span className="flex-1" />
          {entry.result && (
            <span className="shrink-0 inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  RESULT_DOT_STYLES[entry.result] ?? "bg-muted-foreground/40",
                )}
              />
              <span
                className={cn(
                  "text-tiny font-bold",
                  entry.result === "denied" || entry.result === "error"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground/60",
                )}
              >
                {t(`privacy.audit.result.${entry.result}`, { defaultValue: entry.result })}
              </span>
            </span>
          )}
          {hasDetail &&
            (expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
            ))}
        </button>

        {expanded && hasDetail && (
          <div className="mt-2 ml-[162px] space-y-1.5">
            {entry.detail && (
              <p className="text-xs text-muted-foreground/90 font-mono break-all whitespace-pre-wrap">
                {entry.detail}
              </p>
            )}
            {metaEntries.length > 0 && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-tiny">
                {metaEntries.map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt className="text-muted-foreground/50 font-mono">{key}</dt>
                    <dd className="font-mono text-foreground/80 break-all">{metaValue(value)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <SettingsSection
      title={t("privacy.audit.title")}
      action={
        <Button
          variant="ghost"
          size="xs"
          className="h-6 px-2 gap-1 text-xs text-muted-foreground"
          onClick={loadEvents}
          disabled={loading}
        >
          {loading ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {t("privacy.audit.refresh")}
        </Button>
      }
    >
      {/* Filters + search */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {ACTOR_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActorFilter(filter)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors",
                actorFilter === filter
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 border border-transparent",
              )}
            >
              {t(`privacy.audit.filter.${filter}`)}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("privacy.audit.search_placeholder")}
            className="w-44 h-7 pl-8 pr-3 bg-background border border-border/60 rounded-lg text-xs focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-muted-foreground/30 font-medium"
          />
        </div>
      </div>

      {/* Retention note */}
      <div className="px-4 py-2 border-t border-border/30">
        <p className="text-tiny text-muted-foreground/60 leading-relaxed">
          {t("privacy.audit.retention")}
        </p>
      </div>

      {/* Events */}
      <div className="divide-y divide-border/30">
        {events.length === 0 && !loading ? (
          <div className="px-4 py-8 flex flex-col items-center gap-2 text-center">
            <History className="w-6 h-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground/60">{t("privacy.audit.empty")}</p>
          </div>
        ) : (
          events.map(renderRow)
        )}
        {loading && events.length > 0 && (
          <div className="px-4 py-2 flex items-center gap-2 text-tiny text-muted-foreground/50">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {t("privacy.audit.loading")}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
