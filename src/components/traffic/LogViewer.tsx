import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, FileText, RefreshCw, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso } from "react-virtuoso";
import { Logger } from "../../lib/logger";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Tooltip } from "../common/Tooltip";

// --- Components ---

/**
 * Memoized Log Line component to prevent redundant colorization/rendering
 */
const LogLine = memo(
  ({
    line,
    index,
    colorize,
  }: {
    line: string;
    index: number;
    colorize: (text: string) => React.ReactNode;
  }) => {
    return (
      <div className="whitespace-pre-wrap break-all hover:bg-foreground/5 px-1 rounded flex gap-3 border-l-2 border-transparent hover:border-primary/20">
        <span className="text-muted-foreground/30 select-none w-10 text-right shrink-0 font-mono text-caption">
          {index + 1}
        </span>
        <span className="flex-1 leading-relaxed">{colorize(line)}</span>
      </div>
    );
  },
);

LogLine.displayName = "LogLine";

interface LogViewerProps {
  onClose: () => void;
}

export function LogViewer({ onClose }: LogViewerProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [logType, setLogType] = useState<"proxy" | "app" | "audit" | "script" | "plugin" | "crash">(
    "proxy",
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch last 1000 lines for the active log type
      const data = await invoke<string[]>("get_logs", {
        logName: logType,
        lines: 1000,
      });
      setLogs(data);
    } catch (error) {
      Logger.error("Failed to fetch logs:", error);
    } finally {
      setLoading(false);
    }
  }, [logType]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Highlighting Logic - Memoized for stability
  const colorizeLog = useMemo(
    () => (text: string) => {
      if (!text) return <span>{text}</span>;

      let html = text
        // 1. Escape HTML first
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // 2. Highlight Time [HH:MM:SS]
      html = html.replace(
        /(\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\])/g,
        '<span class="text-muted-foreground font-mono text-small">$1</span>',
      );

      // 3. Highlight Keywords
      html = html.replace(
        /\b(ERROR|FAIL|FATAL|Exception|Panic|CRITICAL)\b/gi,
        '<span class="text-red-500 font-bold">$1</span>',
      );
      html = html.replace(/\b(CRASH)\b/gi, '<span class="text-red-500 font-bold">$1</span>');
      html = html.replace(
        /\b(WARN|WARNING)\b/gi,
        '<span class="text-yellow-500 font-bold">$1</span>',
      );
      html = html.replace(/\b(INFO)\b/gi, '<span class="text-blue-500 font-bold">$1</span>');
      html = html.replace(/\b(DEBUG)\b/gi, '<span class="text-gray-500 font-bold">$1</span>');
      html = html.replace(/\b(SUCCESS)\b/gi, '<span class="text-green-500 font-bold">$1</span>');
      html = html.replace(/\[AUDIT\]/g, '<span class="text-amber-500 font-bold">[AUDIT]</span>');
      html = html.replace(/\[SCRIPT\]/g, '<span class="text-purple-500 font-bold">[SCRIPT]</span>');
      html = html.replace(/\[PLUGIN\]/g, '<span class="text-pink-500 font-bold">[PLUGIN]</span>');
      html = html.replace(/\[CRASH\]/g, '<span class="text-red-500 font-bold">[CRASH]</span>');

      // 4. Highlight HTTP Methods
      html = html.replace(
        /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT)\b/g,
        '<span class="text-purple-400 font-bold">$1</span>',
      );

      // 5. Highlight Status Codes
      html = html.replace(
        /(\s|\[)([2][0-9]{2})\b/g,
        '$1<span class="text-green-600 dark:text-green-400">$2</span>',
      );
      html = html.replace(
        /(\s|\[)([3][0-9]{2})\b/g,
        '$1<span class="text-blue-600 dark:text-blue-400">$2</span>',
      );
      html = html.replace(
        /(\s|\[)([45][0-9]{2})\b/g,
        '$1<span class="text-red-600 dark:text-red-400">$2</span>',
      );

      // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized log content with color highlighting
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    },
    [],
  );

  // Filtered logs - moved to useMemo to avoid filtering during every tiny state change
  const filteredLogs = useMemo(() => {
    if (logType !== "proxy") return logs;
    return logs.filter((line) => {
      if (line.includes("/_relay/poll")) return false;
      if (line.includes("127.0.0.1") && line.includes(":9090")) return false;
      return true;
    });
  }, [logs, logType]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-5xl h-[85vh] bg-card border border-white/5 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-muted/10 shrink-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="font-bold text-sm tracking-tight">{t("log_viewer.title")}</h2>
            </div>

            {/* Tab Switcher */}
            <div className="flex items-center bg-muted/20 p-1 rounded-xl border border-border/40 gap-0.5 overflow-x-auto no-scrollbar">
              {[
                { id: "proxy", label: t("log_viewer.proxy_logs") },
                { id: "app", label: t("log_viewer.app_logs") },
                { id: "audit", label: t("log_viewer.audit_logs") },
                { id: "script", label: t("log_viewer.script_logs") },
                { id: "plugin", label: t("log_viewer.plugin_logs") },
                { id: "crash", label: t("log_viewer.crash_logs") },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setLogType(tab.id as any)}
                  className={`px-4 py-1.5 text-small rounded-lg transition-all duration-200 whitespace-nowrap uppercase tracking-wider ${
                    logType === tab.id
                      ? "bg-background text-primary shadow-sm font-black"
                      : "text-muted-foreground/60 hover:text-foreground hover:bg-white/5 font-bold"
                  }`}
                >
                  {tab.label.replace(/\s*\(.*?\)/, "").replace(/ Log| Logs/i, "")}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content={t("log_viewer.refresh")} side="bottom">
              <Button
                variant="quiet"
                size="icon"
                onClick={fetchLogs}
                disabled={loading}
                className="h-9 w-9 rounded-xl"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </Tooltip>

            <Button
              variant="quiet"
              size="icon"
              onClick={onClose}
              className="h-9 w-9 rounded-xl hover:bg-destructive/10 hover:text-destructive group"
            >
              <X className="w-5 h-5 opacity-60 group-hover:opacity-100" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col relative bg-muted/5">
          {loading && filteredLogs.length === 0 ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 animate-spin text-primary/40" />
                <span className="text-caption uppercase font-black tracking-widest text-muted-foreground/40">
                  {t("common.loading")}
                </span>
              </div>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <EmptyState
                icon={FileText}
                title={t("log_viewer.empty_or_no_log")}
                variant="minimal"
                animation="float"
                className="opacity-40"
                titleClassName="text-sm font-bold uppercase tracking-tight"
              />
            </div>
          ) : (
            <div className="h-full relative font-mono text-xs bg-background/80">
              <Virtuoso
                data={filteredLogs}
                followOutput="auto"
                initialTopMostItemIndex={Math.max(0, filteredLogs.length - 1)}
                className="no-scrollbar"
                style={{ height: "100%" }}
                itemContent={(index, line) => (
                  <LogLine
                    key={`${logType}-${index}`}
                    line={line}
                    index={index}
                    colorize={colorizeLog}
                  />
                )}
              />
            </div>
          )}
        </div>

        {/* Footer / Toolbar */}
        <div className="px-4 py-2 border-t border-border bg-background flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500/90" />
            <span className="text-yellow-600/80 dark:text-yellow-500/80 font-medium">
              {t("log_viewer.sensitive_warning")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
