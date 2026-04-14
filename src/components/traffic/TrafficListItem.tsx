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
import { getReadableUrlPreview } from "../../lib/flowUrl";
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
  rowHeight: number;
  onSelect: (index: FlowIndex) => void;
  onContextMenu: (e: React.MouseEvent, index: FlowIndex) => void;
}

export const TrafficListItem = memo(
  ({
    index,
    seq,
    isSelected,
    idColWidth,
    rowHeight,
    onSelect,
    onContextMenu,
  }: TrafficListItemProps) => {
    const { t } = useTranslation();
    // Use isIntercepted from backend - only true for flows actually intercepted by breakpoints
    const isIntercepted = index.isIntercepted;

    // Determine if flow has error
    const isError = index.hasError || String(index.status) === "0";

    const isLocal =
      !index.clientIp ||
      index.clientIp === "127.0.0.1" ||
      index.clientIp === "::1" ||
      index.clientIp === "localhost";

    const httpVersion = index.httpVersion || "HTTP/1.1";
    const displayUrlPreview = getReadableUrlPreview(
      index.url || `${index.host || ""}${index.path || ""}`,
    );

    // Deduplicate hits while preserving script/breakpoint/rule distinctions.
    // For breakpoints, merge request/response phase into one indicator.
    const dedupedHits = index.hits
      ? [
          ...new Map(
            index.hits.map((h) => [
              h.type === "breakpoint"
                ? `breakpoint:${h.id.replace(/:request$|:response$/, "")}`
                : `${h.type}:${h.id}`,
              h,
            ]),
          ).values(),
        ]
      : [];

    const showHitColumn = (index.hits && index.hits.length > 0) || isIntercepted;

    return (
      <div
        onClick={() => onSelect(index)}
        onContextMenu={(e) => onContextMenu(e, index)}
        className={`group flex items-center gap-2 px-3 cursor-pointer relative border-b border-subtle transition-[background-color] duration-150 ${
          isSelected ? "bg-primary/5" : "bg-transparent hover:bg-muted/40"
        }`}
        style={{
          height: rowHeight,
          boxSizing: "border-box",
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
          className="text-micro text-right font-mono text-muted-foreground/60 select-none mr-0.5"
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
            <Tooltip content={t("traffic.source.local")} side="bottom">
              <Laptop className="w-3.5 h-3.5 opacity-20 grayscale" />
            </Tooltip>
          ) : (
            <Tooltip content={`${t("traffic.source.remote")} (${index.clientIp})`} side="bottom">
              <Smartphone className="w-3.5 h-3.5 text-blue-500/70" />
            </Tooltip>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="text-xs font-mono font-semibold truncate text-foreground/90 group-hover:text-primary transition-colors flex-1">
              {displayUrlPreview || t("traffic.url_unavailable")}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`px-1.5 py-0 rounded-sm border text-micro font-semibold tracking-wider ${getHttpStatusCodeClass(index.status)}`}
            >
              {isError ? (
                <Tooltip content={t("traffic.status.failed")} side="bottom">
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

        {/* Hit indicators: fixed slot so Virtuoso row height stays stable while scrolling */}
        <div className="flex min-h-[28px] min-w-[5.5rem] flex-shrink-0 items-center justify-end gap-1.5 px-2">
          {showHitColumn ? (
            <>
              {isIntercepted && (
                <Tooltip content={t("traffic.breakpoint_active_tooltip")} side="left">
                  <div className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                    <div className="absolute inset-0 rounded-full bg-red-500/30 blur-[4px] animate-pulse" />
                    <div className="relative flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)] animate-pulse">
                      <CirclePause className="h-2.5 w-2.5 text-white" strokeWidth={2} />
                    </div>
                  </div>
                </Tooltip>
              )}
              {index.hits?.some((h) => h.status === "file_not_found") && (
                <Tooltip content={t("traffic.file_not_found")} side="left">
                  <AlertTriangle className="h-3 w-3 flex-shrink-0 text-error" />
                </Tooltip>
              )}
              <div className="flex -space-x-1">
                {dedupedHits.slice(0, 5).map((hit, idx) => {
                  const isScript = hit.type === "script";
                  const isBreakpoint = hit.type === "breakpoint";
                  let tooltipContent = "";
                  if (isScript) {
                    tooltipContent = `${t("common.script")}: ${hit.name}`;
                  } else if (isBreakpoint) {
                    tooltipContent = `${t("common.breakpoint")}: ${hit.name}`;
                  } else {
                    tooltipContent = `${t("common.rule")}: ${hit.name}`;
                  }
                  return (
                    <Tooltip key={`${hit.id}-${idx}`} content={tooltipContent} side="left">
                      {isScript ? (
                        <div className="flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white shadow-[0_1px_2px_rgba(99,102,241,0.4)]">
                          <Terminal className="h-[9px] w-[9px]" strokeWidth={2.5} />
                        </div>
                      ) : isBreakpoint ? (
                        <CirclePause
                          className="h-3 w-3 flex-shrink-0 text-red-500"
                          strokeWidth={2}
                        />
                      ) : (
                        <div
                          className={`h-2 w-2 rounded-full ring-1 ring-background/70 shadow-sm ${getRuleTypeDotClass(hit.type, hit.status)}`}
                        />
                      )}
                    </Tooltip>
                  );
                })}
                {dedupedHits.length > 5 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    +{dedupedHits.length - 5}
                  </span>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    );
  },
);

TrafficListItem.displayName = "TrafficListItem";
