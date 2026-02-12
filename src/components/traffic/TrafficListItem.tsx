import { AlertTriangle, Laptop, ShieldAlert, StopCircle, Terminal } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { formatProtocol, getProtocolColor } from "../../lib/utils";
import type { FlowIndex, FlowIndexHit } from "../../types";
import { Tooltip } from "../common/Tooltip";

interface TrafficListItemProps {
  index: FlowIndex;
  isSelected: boolean;
  idColWidth: number;
  breakpoints: Array<{ pattern: string }>;
  onSelect: (index: FlowIndex) => void;
  onContextMenu: (e: React.MouseEvent, index: FlowIndex) => void;
}

// Get hit dot color based on rule type
const getHitDotColor = (hit: FlowIndexHit) => {
  if (hit.status === "file_not_found") return "bg-red-500";
  switch (hit.type) {
    case "rewrite_body":
      return "bg-purple-500";
    case "map_local":
      return "bg-blue-500";
    case "map_remote":
      return "bg-emerald-500";
    case "rewrite_header":
      return "bg-orange-500";
    case "throttle":
      return "bg-cyan-500";
    case "block_request":
      return "bg-rose-500";
    default:
      return "bg-gray-500";
  }
};

export const TrafficListItem = memo(
  ({
    index,
    isSelected,
    idColWidth,
    breakpoints,
    onSelect,
    onContextMenu,
  }: TrafficListItemProps) => {
    const { t } = useTranslation();
    const isBreakpointMatch = breakpoints.some((b) => index.url.includes(b.pattern));

    // Determine method badge style
    const getMethodBadgeClass = () => {
      switch (index.method) {
        case "GET":
          return "bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-900";
        case "POST":
          return "bg-green-500/10 text-green-600 border-green-200 dark:border-green-900";
        case "PUT":
          return "bg-yellow-500/10 text-yellow-600 border-yellow-200 dark:border-yellow-900";
        case "DELETE":
          return "bg-red-500/10 text-red-600 border-red-200 dark:border-red-900";
        default:
          return "bg-gray-500/10 text-gray-600 border-gray-200 dark:border-gray-800";
      }
    };

    // Determine if flow has error
    const isError = index.hasError || String(index.status) === "0";

    // Determine status code color
    const getStatusCodeClass = () => {
      if (index.status === 0) return "text-red-500/50 italic font-medium";
      if (index.status === null) return "text-muted-foreground/60 font-bold";
      if (index.status < 300) return "text-green-500";
      if (index.status < 400) return "text-yellow-500";
      return "text-red-500";
    };

    // Determine duration badge style
    const getDurationClass = () => {
      if (!index.time) return "";
      if (index.time < 400) return "bg-muted/10 text-muted-foreground/50";
      if (index.time < 1000) return "bg-yellow-500/5 text-yellow-500/80";
      if (index.time < 3000) return "bg-orange-500/10 text-orange-500";
      return "bg-red-500/10 text-red-500 animate-pulse font-bold";
    };

    // Determine HTTP version from contentType or default to HTTP/1.1
    const httpVersion = "HTTP/1.1"; // FlowIndex doesn't have this, use default

    return (
      <div
        onClick={() => onSelect(index)}
        onContextMenu={(e) => onContextMenu(e, index)}
        className={`group flex items-center gap-2 px-3 cursor-pointer transition-all relative border-b border-border/20 ${
          isSelected ? "bg-primary/5" : "bg-transparent hover:bg-muted/40"
        }`}
        style={{
          paddingTop: "var(--density-p, 8px)",
          paddingBottom: "var(--density-p, 8px)",
        }}
      >
        {/* Status Indicator Bar */}
        <div
          className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${
            isSelected ? "bg-primary" : "bg-transparent"
          }`}
        />

        {/* Breakpoint Highlighting */}
        {isBreakpointMatch && <div className="absolute right-0 top-0 bottom-0 w-1 bg-red-500/50" />}

        {/* ID Column */}
        <div
          className="text-[10px] text-right font-mono text-muted-foreground/60 select-none mr-1 transition-all"
          style={{ minWidth: idColWidth, maxWidth: idColWidth }}
        >
          {index.seq}
        </div>

        {/* Method Badge */}
        <div
          className={`w-16 text-[10px] font-bold text-center px-1.5 py-0.5 rounded border ${getMethodBadgeClass()}`}
        >
          {index.method}
        </div>

        {/* Source Icon - Always render for alignment (Faint for Local) */}
        {/* Note: FlowIndex doesn't have clientIp, so we can't determine remote vs local */}
        <div className="w-5 flex justify-center text-muted-foreground/60 flex-shrink-0">
          <Tooltip content={t("traffic.source.local", "Local")} side="bottom">
            <Laptop className="w-3.5 h-3.5 opacity-20 grayscale" />
          </Tooltip>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="text-xs font-mono font-medium truncate text-foreground/90 group-hover:text-primary transition-colors flex-1">
              {index.url}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className={getStatusCodeClass()}>
              {isError ? (
                <Tooltip content={t("traffic.status.failed", "Connection Failed")} side="bottom">
                  <div className="flex items-center justify-center w-6 h-4 cursor-help">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                  </div>
                </Tooltip>
              ) : String(index.status) === "0" ? (
                ""
              ) : (
                index.status || "..."
              )}
            </span>
            <span>•</span>
            <span
              className={`font-mono text-[9px] px-1 rounded-sm border ${getProtocolColor(httpVersion)}`}
            >
              {formatProtocol(httpVersion)}
            </span>
            <span>•</span>
            {index.time ? (
              <span
                className={`px-1.5 py-0.5 rounded-[4px] font-mono transition-colors ${getDurationClass()}`}
              >
                {index.time.toFixed(0)}ms
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/30 italic">
                {t("traffic.status.pending")}
              </span>
            )}

            <span>•</span>
            <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/40 font-mono tracking-tighter">
              {new Date(index.startedDateTime).toLocaleTimeString([], {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* Hit Indicators */}
        {index.hits && index.hits.length > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0 px-2">
            {isBreakpointMatch && (
              <Tooltip
                content={t("traffic.breakpoint_hit_tooltip", "This domain has breakpoint enabled")}
                side="left"
              >
                <StopCircle className="w-4 h-4 text-red-500 animate-pulse" />
              </Tooltip>
            )}
            {/* File not found warning */}
            {index.hits.some((h) => h.status === "file_not_found") && (
              <Tooltip content={t("traffic.file_not_found", "File not found")} side="left">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              </Tooltip>
            )}
            <div className="flex -space-x-1">
              {index.hits.slice(0, 5).map((hit, idx) => {
                const isScript = hit.type === "script";
                const tooltipContent = isScript
                  ? `${t("common.script", "Script")}: ${hit.name}`
                  : `${t("common.rule", "Rule")}: ${hit.name}`;
                return (
                  <Tooltip key={`${hit.id}-${idx}`} content={tooltipContent} side="left">
                    {isScript ? (
                      <div className="w-2.5 h-2.5 flex items-center justify-center rounded-full bg-indigo-500/20 ring-1 ring-indigo-500/50 -translate-y-[1px]">
                        <Terminal className="w-1.5 h-1.5 text-indigo-400" />
                      </div>
                    ) : (
                      <div
                        className={`w-2 h-2 rounded-full ring-1 ring-background ${getHitDotColor(hit)}`}
                      />
                    )}
                  </Tooltip>
                );
              })}
              {index.hits.length > 5 && (
                <span className="text-[9px] text-muted-foreground ml-1">
                  +{index.hits.length - 5}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

TrafficListItem.displayName = "TrafficListItem";
