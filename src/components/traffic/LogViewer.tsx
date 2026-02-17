import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Cpu,
  FileText,
  Info,
  Layers,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
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
      <div className="group whitespace-pre-wrap break-all hover:bg-primary/5 px-2 py-0.5 rounded transition-colors flex gap-4 border-l-2 border-transparent hover:border-primary/20">
        <span className="text-tiny text-muted-foreground/30 select-none w-10 text-right shrink-0 font-mono mt-0.5">
          {index + 1}
        </span>
        <span className="flex-1 leading-relaxed text-tiny font-medium tracking-tight font-mono">
          {colorize(line)}
        </span>
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
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
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

      let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // 1. Highlight Time [HH:MM:SS]
      html = html.replace(
        /(\[\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}(?:\.\d+)?\]|\[\d{2}:\d{2}:\d{2}(?:\.\d+)?\])/g,
        '<span class="text-muted-foreground/40 font-mono text-micro">$1</span>',
      );

      // 2. Highlight Keywords with refined colors
      html = html.replace(
        /\b(ERROR|FAIL|FATAL|Exception|Panic|CRITICAL)\b/gi,
        '<span class="text-rose-500 font-bold bg-rose-500/10 px-1 rounded-sm">$1</span>',
      );
      html = html.replace(
        /\b(CRASH)\b/gi,
        '<span class="text-rose-600 font-black bg-rose-600/20 px-1 rounded-sm">$1</span>',
      );
      html = html.replace(
        /\b(WARN|WARNING)\b/gi,
        '<span class="text-amber-500 font-bold bg-amber-500/10 px-1 rounded-sm">$1</span>',
      );
      html = html.replace(/\b(INFO)\b/gi, '<span class="text-blue-500/70 font-bold">$1</span>');
      html = html.replace(
        /\b(DEBUG)\b/gi,
        '<span class="text-muted-foreground/50 font-medium">$1</span>',
      );
      html = html.replace(/\b(SUCCESS)\b/gi, '<span class="text-emerald-500 font-bold">$1</span>');
      html = html.replace(
        /\[AUDIT\]/g,
        '<span class="text-amber-500/80 font-bold border-b border-amber-500/20">[AUDIT]</span>',
      );
      html = html.replace(
        /\[SCRIPT\]/g,
        '<span class="text-indigo-500/80 font-bold border-b border-indigo-500/20">[SCRIPT]</span>',
      );
      html = html.replace(
        /\[PLUGIN\]/g,
        '<span class="text-pink-500/80 font-bold border-b border-pink-500/20">[PLUGIN]</span>',
      );

      // 3. Highlight HTTP Methods
      html = html.replace(
        /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT)\b/g,
        '<span class="text-violet-500/80 font-bold">$1</span>',
      );

      // 4. Highlight Status Codes with badges
      html = html.replace(
        /(\s|\[)([2][0-9]{2})\b/g,
        '$1<span class="text-emerald-600 dark:text-emerald-400 font-bold">$2</span>',
      );
      html = html.replace(
        /(\s|\[)([3][0-9]{2})\b/g,
        '$1<span class="text-sky-600 dark:text-sky-400 font-bold">$2</span>',
      );
      html = html.replace(
        /(\s|\[)([45][0-9]{2})\b/g,
        '$1<span class="text-rose-600 dark:text-rose-400 font-bold">$2</span>',
      );

      // biome-ignore lint/security/noDangerouslySetInnerHtml: Sanitized log content with color highlighting
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    },
    [],
  );

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (logType === "proxy") {
      result = logs.filter((line) => {
        if (line.includes("/_relay/poll")) return false;
        if (line.includes("127.0.0.1") && line.includes(":9090")) return false;
        return true;
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((line) => line.toLowerCase().includes(q));
    }

    return result;
  }, [logs, logType, searchQuery]);

  const tabs = [
    { id: "proxy", label: t("log_viewer.proxy_logs"), icon: Server },
    { id: "app", label: t("log_viewer.app_logs"), icon: Cpu },
    { id: "audit", label: t("log_viewer.audit_logs"), icon: ShieldAlert },
    { id: "script", label: t("log_viewer.script_logs"), icon: Terminal },
    { id: "plugin", label: t("log_viewer.plugin_logs"), icon: Layers },
    { id: "crash", label: t("log_viewer.crash_logs"), icon: AlertTriangle },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/25 backdrop-blur-[1px]"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="w-full max-w-6xl h-[85vh] bg-background/95 backdrop-blur-xl border border-border/40 rounded-xl shadow-2xl flex flex-col overflow-hidden relative"
      >
        {/* Header Area */}
        <div className="flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
                <FileText className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="font-bold text-sm tracking-tight text-foreground/90">
                  {t("log_viewer.title")}
                </h2>
                <p className="text-micro text-muted-foreground/40 font-bold tracking-wider uppercase -mt-0.5">
                  {logType} logs
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Internal Search Bar - Compact */}
              <div className="relative group hidden md:block">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
                <input
                  type="text"
                  placeholder={t("common.search")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-48 h-7 pl-8 pr-3 bg-background border border-border/60 rounded-lg text-xs focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-muted-foreground/30 font-medium shadow-sm"
                />
              </div>

              <div className="w-px h-4 bg-border/40 mx-0.5" />

              <Tooltip content={t("log_viewer.refresh")} side="bottom">
                <Button
                  variant="quiet"
                  size="icon"
                  onClick={fetchLogs}
                  disabled={loading}
                  className="h-8 w-8 rounded-lg hover:bg-muted/50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-muted-foreground/60 ${loading ? "animate-spin" : ""}`}
                  />
                </Button>
              </Tooltip>

              <Button
                variant="quiet"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 rounded-lg hover:bg-rose-500/10 hover:text-rose-500 group"
              >
                <X className="w-4 h-4 opacity-40 group-hover:opacity-100 transition-opacity" />
              </Button>
            </div>
          </div>

          {/* Tab Navigation - More Compact */}
          <div className="px-4 py-1.5 bg-muted/10 border-b border-border/20 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setLogType(tab.id as any)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-tiny font-bold tracking-tight transition-all relative ${
                      logType === tab.id
                        ? "text-primary bg-primary/10 border border-primary/20"
                        : "text-muted-foreground/40 hover:text-muted-foreground/80 hover:bg-background/40 border border-transparent"
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 ${logType === tab.id ? "opacity-100" : "opacity-40"}`}
                    />
                    {tab.label.replace(/\s*\(.*?\)/, "").replace(/ Log| Logs/i, "")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col relative bg-muted/5">
          <AnimatePresence mode="wait">
            {loading && filteredLogs.length === 0 ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm"
              >
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-xl animate-pulse rounded-full" />
                    <RefreshCw className="w-8 h-8 animate-spin text-primary relative z-10" />
                  </div>
                  <span className="text-micro uppercase font-black tracking-[0.2em] text-primary/40">
                    Sequencing logs...
                  </span>
                </div>
              </motion.div>
            ) : filteredLogs.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="h-full flex items-center justify-center p-12"
              >
                <EmptyState
                  icon={FileText}
                  title={t("log_viewer.empty_or_no_log")}
                  description="No system records found for this category"
                  variant="minimal"
                  animation="float"
                  className="opacity-60"
                  titleClassName="text-base font-bold tracking-tight text-foreground/80"
                />
              </motion.div>
            ) : (
              <motion.div
                key="content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full relative font-mono selection:bg-primary/30"
              >
                <Virtuoso
                  data={filteredLogs}
                  followOutput="auto"
                  initialTopMostItemIndex={Math.max(0, filteredLogs.length - 1)}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Status Bar / Footer */}
        <div className="px-5 py-2.5 border-t border-border/40 bg-muted/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 text-micro uppercase tracking-widest font-black text-muted-foreground/30">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Stream
            </span>
            <span className="w-px h-3 bg-border/40" />
            <span>{filteredLogs.length} Entries</span>
          </div>

          <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/5 border border-rose-500/10 group overflow-hidden">
            <Info className="w-3 h-3 text-rose-500/60 group-hover:text-rose-500 transition-colors" />
            <span className="text-micro font-bold text-rose-500/60 group-hover:text-rose-500 transition-colors tracking-tight">
              {t("log_viewer.sensitive_warning")}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
