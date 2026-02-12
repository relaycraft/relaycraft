import { AlertTriangle, Laptop, ShieldAlert, Smartphone, StopCircle, Terminal } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { formatProtocol, getProtocolColor } from "../../lib/utils";
import type { Flow, RcMatchedHit } from "../../types";
import { Tooltip } from "../common/Tooltip";

interface TrafficListItemProps {
  flow: Flow;
  isSelected: boolean;
  idColWidth: number;
  breakpoints: Array<{ pattern: string }>;
  onSelect: (flow: Flow) => void;
  onContextMenu: (e: React.MouseEvent, flow: Flow) => void;
}

export const TrafficListItem = memo(
  ({
    flow,
    isSelected,
    idColWidth,
    breakpoints,
    onSelect,
    onContextMenu,
  }: TrafficListItemProps) => {
    const { t } = useTranslation();
    const hasHits = flow._rc.hits && flow._rc.hits.length > 0;
    const isBreakpointMatch = breakpoints.some((b) => flow.request.url.includes(b.pattern));

    // Determine method badge style
    const getMethodBadgeClass = () => {
      switch (flow.request.method) {
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
    const isError = flow._rc.error || String(flow.response.status) === "0";

    // Determine status code color
    const getStatusCodeClass = () => {
      if (flow.response.status === 0) return "text-red-500/50 italic font-medium";
      if (flow.response.status === null) return "text-muted-foreground/60 font-bold";
      if (flow.response.status < 300) return "text-green-500";
      if (flow.response.status < 400) return "text-yellow-500";
      return "text-red-500";
    };

    // Determine duration badge style
    const getDurationClass = () => {
      if (!flow.time) return "";
      if (flow.time < 400) return "bg-muted/10 text-muted-foreground/50";
      if (flow.time < 1000) return "bg-yellow-500/5 text-yellow-500/80";
      if (flow.time < 3000) return "bg-orange-500/10 text-orange-500";
      return "bg-red-500/10 text-red-500 animate-pulse font-bold";
    };

    // Get hit dot color
    const getHitDotColor = (hit: RcMatchedHit) => {
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

    return (
      <div
        onClick={() => onSelect(flow)}
        onContextMenu={(e) => onContextMenu(e, flow)}
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
          {flow.seq}
        </div>

        {/* Method Badge */}
        <div
          className={`w-16 text-[10px] font-bold text-center px-1.5 py-0.5 rounded border ${getMethodBadgeClass()}`}
        >
          {flow.request.method}
        </div>

        {/* Source Icon - Always render for alignment (Faint for Local) */}
        <div className="w-5 flex justify-center text-muted-foreground/60 flex-shrink-0">
          {flow._rc.clientIp && flow._rc.clientIp !== "127.0.0.1" && flow._rc.clientIp !== "::1" ? (
            <Tooltip
              content={`${t("traffic.source.remote", "Remote")} (${flow._rc.clientIp})`}
              side="bottom"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-400" />
            </Tooltip>
          ) : (
            <Tooltip content={t("traffic.source.local", "Local")} side="bottom">
              <Laptop className="w-3.5 h-3.5 opacity-20 grayscale" />
            </Tooltip>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="text-xs font-mono font-medium truncate text-foreground/90 group-hover:text-primary transition-colors flex-1">
              {flow.request.url}
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className={getStatusCodeClass()}>
              {isError ? (
                <Tooltip
                  content={(() => {
                    const msg = flow._rc.error?.message || "";
                    if (msg.includes("client does not trust") || msg.includes("unknown ca")) {
                      return (
                        <div className="text-center whitespace-nowrap">
                          {t("traffic.security.untrusted_title", "Root Certificate Not Trusted")}:{" "}
                          {t(
                            "traffic.security.untrusted_desc",
                            "Please install and trust the RelayCraft CA on your device.",
                          )}
                        </div>
                      );
                    }
                    if (msg.includes("certificate unknown") || msg.includes("alert unknown")) {
                      return (
                        <div className="text-center whitespace-nowrap">
                          SSL Pinning / Security Restriction: App rejected our certificate. It
                          likely uses SSL Pinning.
                        </div>
                      );
                    }
                    return msg || "Connection Failed";
                  })()}
                  side="bottom"
                >
                  <div className="flex items-center justify-center w-6 h-4 cursor-help">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                  </div>
                </Tooltip>
              ) : String(flow.response.status) === "0" ? (
                ""
              ) : (
                flow.response.status || "..."
              )}
            </span>
            <span>•</span>
            {flow.request.httpVersion && (
              <>
                <span
                  className={`font-mono text-[9px] px-1 rounded-sm border ${getProtocolColor(flow.request.httpVersion)}`}
                >
                  {formatProtocol(flow.request.httpVersion)}
                </span>
                <span>•</span>
              </>
            )}
            {flow.time ? (
              <span
                className={`px-1.5 py-0.5 rounded-[4px] font-mono transition-colors ${getDurationClass()}`}
              >
                {flow.time.toFixed(0)}ms
              </span>
            ) : (
              (() => {
                const errorMsg = flow._rc.error?.message || "";
                const isSSLError =
                  errorMsg.includes("client does not trust") ||
                  errorMsg.includes("unknown ca") ||
                  errorMsg.includes("certificate unknown") ||
                  errorMsg.includes("alert unknown");

                if (isError) {
                  if (isSSLError) {
                    // Use a neutral gray style for Encrypted/SSL errors to indicate "we just can't see it"
                    return (
                      <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/10 text-muted-foreground/70 font-medium text-[10px]">
                        {t("traffic.status.encrypted", "Encrypted")}
                      </span>
                    );
                  }
                  return (
                    <span className="px-1.5 py-0.5 rounded-[4px] bg-red-500/10 text-red-500 font-medium text-[10px]">
                      {t("traffic.status.failed", "Failed")}
                    </span>
                  );
                }
                return (
                  <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/30 italic">
                    {t("traffic.status.pending")}
                  </span>
                );
              })()
            )}

            <span>•</span>
            <span className="px-1.5 py-0.5 rounded-[4px] bg-muted/5 text-muted-foreground/40 font-mono tracking-tighter">
              {new Date(flow.startedDateTime).toLocaleTimeString([], {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* Hit Indicators */}
        {hasHits && (
          <div className="flex items-center gap-1.5 flex-shrink-0 px-2">
            {isBreakpointMatch && (
              <Tooltip
                content={t("traffic.breakpoint_hit_tooltip", "This domain has breakpoint enabled")}
                side="left"
              >
                <StopCircle className="w-4 h-4 text-red-500 animate-pulse" />
              </Tooltip>
            )}
            {flow._rc.hits?.some((h) => h.status === "file_not_found") && (
              <Tooltip content={t("traffic.file_not_found", "File not found")} side="left">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              </Tooltip>
            )}
            <div className="flex -space-x-1">
              {flow._rc.hits?.map((hit, idx) => (
                <Tooltip
                  key={idx}
                  content={`${hit.type === "script" ? t("common.script", "Script") : t("common.rule", "Rule")}: ${hit.name}`}
                  side="left"
                >
                  {hit.type === "script" ? (
                    <div className="w-2.5 h-2.5 flex items-center justify-center rounded-full bg-indigo-500/20 ring-1 ring-indigo-500/50 -translate-y-[1px]">
                      <Terminal className="w-1.5 h-1.5 text-indigo-400" />
                    </div>
                  ) : (
                    <div
                      className={`w-2 h-2 rounded-full ring-1 ring-background ${getHitDotColor(hit)}`}
                    />
                  )}
                </Tooltip>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  },
);

TrafficListItem.displayName = "TrafficListItem";
