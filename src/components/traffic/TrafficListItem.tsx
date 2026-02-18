import {
  AlertTriangle,
  CirclePause,
  Laptop,
  ShieldAlert,
  Smartphone,
  Terminal,
} from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  formatProtocol,
  getDurationBadgeClass,
  getHttpMethodBadgeClass,
  getHttpStatusCodeClass,
  getProtocolColor,
  getRuleTypeDotClass,
} from "../../lib/utils";
import type { FlowIndex } from "../../types";
import { Tooltip } from "../common/Tooltip";

interface TrafficListItemProps {
  index: FlowIndex;
  seq: number; // Display sequence number (calculated from array index)
  isSelected: boolean;
  idColWidth: number;
  onSelect: (index: FlowIndex) => void;
  onContextMenu: (e: React.MouseEvent, index: FlowIndex) => void;
}

export const TrafficListItem = memo(
  ({ index, seq, isSelected, idColWidth, onSelect, onContextMenu }: TrafficListItemProps) => {
    const { t } = useTranslation();
    // Use isIntercepted from backend - only true for flows actually intercepted by breakpoints
    const isIntercepted = index.isIntercepted;

    // Determine if flow has error
    const isError = index.hasError || String(index.status) === "0";

    // Determine if request is from local machine or remote device (mobile)
    // Only 127.0.0.1 and ::1 are truly "local" (from the same machine)
    // 192.168.x.x, 10.x.x.x, etc. are remote devices on local network (like phones on WiFi)
    const isLocal =
      !index.clientIp ||
      index.clientIp === "127.0.0.1" ||
      index.clientIp === "::1" ||
      index.clientIp === "localhost";

    // Determine HTTP version from contentType or default to HTTP/1.1
    const httpVersion = "HTTP/1.1"; // FlowIndex doesn't have this, use default

    return (
      <div
        onClick={() => onSelect(index)}
        onContextMenu={(e) => onContextMenu(e, index)}
        className={`group flex items-center gap-2 px-3 cursor-pointer transition-all relative border-b border-subtle ${
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

        {/* ID Column */}
        <div
          className="text-micro text-right font-mono text-muted-foreground/60 select-none mr-0.5 transition-all"
          style={{ minWidth: idColWidth, maxWidth: idColWidth }}
        >
          {seq}
        </div>

        {/* Method Badge */}
        <div
          className={`w-[62px] flex-shrink-0 flex items-center justify-center text-micro font-semibold tracking-wider py-0.5 rounded border ${getHttpMethodBadgeClass(index.method)}`}
        >
          {index.method}
        </div>

        {/* Source Icon - Distinguish between Local and Remote (Mobile) */}
        <div className="w-5 flex justify-center text-muted-foreground/60 flex-shrink-0">
          {isLocal ? (
            <Tooltip content={t("traffic.source.local", "Local")} side="bottom">
              <Laptop className="w-3.5 h-3.5 opacity-20 grayscale" />
            </Tooltip>
          ) : (
            <Tooltip
              content={`${t("traffic.source.remote", "Remote Device")} (${index.clientIp})`}
              side="bottom"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-500/70" />
            </Tooltip>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="text-xs font-mono font-semibold truncate text-foreground/90 group-hover:text-primary transition-colors flex-1">
              {index.url}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`px-1.5 py-0 rounded-sm border text-micro font-semibold tracking-wider ${getHttpStatusCodeClass(index.status)}`}
            >
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
              className={`font-mono text-tiny px-1 rounded-sm border ${getProtocolColor(httpVersion)}`}
            >
              {formatProtocol(httpVersion)}
            </span>
            <span>•</span>
            {index.time ? (
              <span
                className={`px-1.5 py-0.5 rounded-[4px] font-mono text-tiny transition-colors ${getDurationBadgeClass(index.time)}`}
              >
                {index.time.toFixed(0)}ms
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/30 italic text-tiny">
                {t("traffic.status.pending")}
              </span>
            )}

            <span>•</span>
            <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/40 font-mono tracking-tighter text-tiny">
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
        {(index.hits && index.hits.length > 0) || isIntercepted ? (
          <div className="flex items-center gap-1.5 flex-shrink-0 px-2">
            {/* Currently intercepted indicator (pulsing) */}
            {isIntercepted && (
              <Tooltip
                content={t(
                  "traffic.breakpoint_active_tooltip",
                  "Currently intercepted by breakpoint",
                )}
                side="left"
              >
                <div className="relative flex items-center justify-center w-5 h-5">
                  <div className="absolute inset-0 bg-red-500/30 rounded-full blur-[4px] animate-pulse" />
                  <div className="relative w-3.5 h-3.5 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse flex items-center justify-center">
                    <CirclePause className="w-2.5 h-2.5 text-white" strokeWidth={2} />
                  </div>
                </div>
              </Tooltip>
            )}
            {/* File not found warning */}
            {index.hits?.some((h) => h.status === "file_not_found") && (
              <Tooltip content={t("traffic.file_not_found", "File not found")} side="left">
                <AlertTriangle className="w-3.5 h-3.5 text-error" />
              </Tooltip>
            )}
            <div className="flex -space-x-1">
              {index.hits &&
                // Deduplicate hits: for breakpoints, use rule_id (without phase) as key
                [
                  ...new Map(
                    index.hits.map((h) => [
                      h.type === "breakpoint" ? h.id.replace(/:request$|:response$/, "") : h.id,
                      h,
                    ]),
                  ).values(),
                ]
                  .slice(0, 5)
                  .map((hit, idx) => {
                    const isScript = hit.type === "script";
                    const isBreakpoint = hit.type === "breakpoint";
                    let tooltipContent = "";
                    if (isScript) {
                      tooltipContent = `${t("common.script", "Script")}: ${hit.name}`;
                    } else if (isBreakpoint) {
                      tooltipContent = `${t("common.breakpoint", "Breakpoint")}: ${hit.name}`;
                    } else {
                      tooltipContent = `${t("common.rule", "Rule")}: ${hit.name}`;
                    }
                    return (
                      <Tooltip key={`${hit.id}-${idx}`} content={tooltipContent} side="left">
                        {isScript ? (
                          <div className="w-3 h-3 flex items-center justify-center rounded-full border border-indigo-500 flex-shrink-0">
                            <Terminal className="w-2 h-2 text-indigo-500" strokeWidth={2.5} />
                          </div>
                        ) : isBreakpoint ? (
                          <CirclePause
                            className="w-3 h-3 text-red-500 flex-shrink-0"
                            strokeWidth={2}
                          />
                        ) : (
                          <div
                            className={`w-2.5 h-2.5 rounded-full border border-background shadow-sm aspect-square ${getRuleTypeDotClass(hit.type, hit.status)}`}
                          />
                        )}
                      </Tooltip>
                    );
                  })}
              {index.hits &&
                [
                  ...new Map(
                    index.hits.map((h) => [
                      h.type === "breakpoint" ? h.id.replace(/:request$|:response$/, "") : h.id,
                      h,
                    ]),
                  ).values(),
                ].length > 5 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    +
                    {[
                      ...new Map(
                        index.hits.map((h) => [
                          h.type === "breakpoint" ? h.id.replace(/:request$|:response$/, "") : h.id,
                          h,
                        ]),
                      ).values(),
                    ].length - 5}
                  </span>
                )}
            </div>
          </div>
        ) : null}
      </div>
    );
  },
);

TrafficListItem.displayName = "TrafficListItem";
