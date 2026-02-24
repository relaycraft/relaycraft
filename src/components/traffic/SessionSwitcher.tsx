import { Check, ChevronDown, Eraser, Eye, History, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { type DbSession, useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";

/**
 * Format bytes to human readable size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * Format timestamp to datetime string (YYYY-MM-DD HH:MM)
 */
function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function SessionSwitcher() {
  const { t } = useTranslation();
  const { showConfirm } = useUIStore();
  const {
    dbSessions,
    showSessionId,
    loadingSessions,
    fetchDbSessions,
    switchDbSession,
    deleteDbSession,
    deleteAllDbSessions,
  } = useSessionStore();
  const { active: isProxyActive } = useProxyStore();

  const [isOpen, setIsOpen] = useState(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  // Fetch sessions on mount
  useEffect(() => {
    fetchDbSessions();
  }, [fetchDbSessions]);

  // Periodically refresh session list to update flow counts
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDbSessions();
    }, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, [fetchDbSessions]);

  // Update position when opening
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const dropdownWidth = 260; // Accurate width of the portal
      setDropdownPosition({
        top: rect.bottom,
        left: Math.min(rect.left, window.innerWidth - dropdownWidth - 16), // 16px safety margin
      });
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't close while clearing is in progress
      if (isClearingAll) return;
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isClearingAll]);

  // Find the session that backend is actively writing to
  const writingSession = isProxyActive ? dbSessions.find((s) => s.is_active === 1) : null;
  const viewingSession = dbSessions.find((s) => s.id === showSessionId);
  // Historical mode: viewing a session that is NOT the current writing session
  const isHistoricalMode =
    !writingSession || (showSessionId && writingSession.id !== showSessionId);

  const handleSwitch = async (sessionId: string) => {
    if (sessionId !== showSessionId) {
      setIsOpen(false);
      await switchDbSession(sessionId);
    }
  };

  const handleDelete = (e: React.MouseEvent, session: DbSession) => {
    e.stopPropagation();
    e.preventDefault();

    // Cannot delete the writing session
    if (session.is_active === 1) return;

    showConfirm({
      title: t("session.delete_title", { defaultValue: "Delete Session" }),
      message: t("session.delete_confirm_msg", {
        name: session.name,
        defaultValue: `Delete this session? This cannot be undone.`,
      }),
      variant: "danger",
      confirmLabel: t("common.delete", { defaultValue: "Delete" }),
      onConfirm: async () => {
        await deleteDbSession(session.id);
      },
    });
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    showConfirm({
      title: t("session.clear_all_confirm", { defaultValue: "Clear All History?" }),
      message: t("session.clear_all_msg", {
        defaultValue: "This will delete all historical sessions. This action cannot be undone.",
      }),
      variant: "danger",
      confirmLabel: t("common.clear", { defaultValue: "Clear" }),
      onConfirm: () => {
        // Start deletion without awaiting — keep dropdown open to show loading state
        setIsClearingAll(true);
        deleteAllDbSessions().finally(() => {
          setIsClearingAll(false);
          setIsOpen(false);
        });
      },
    });
  };

  const hasHistoricalSessions = dbSessions.some((s) => s.is_active === 0);

  // if (dbSessions.length <= 1) {
  //   return null;
  // }

  const toggleDropdown = () => {
    if (!isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const dropdownWidth = 260;
      setDropdownPosition({
        top: rect.bottom,
        left: Math.min(rect.left, window.innerWidth - dropdownWidth - 16),
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Tooltip
        content={
          isHistoricalMode
            ? t("session.historical_mode", { defaultValue: "Viewing historical session" })
            : writingSession
              ? t("session.switch_hint", { defaultValue: "Switch session" })
              : t("common.loading", { defaultValue: "Loading..." })
        }
      >
        <Button
          variant="ghost"
          size="xs"
          onClick={toggleDropdown}
          className={`h-7 px-2.5 gap-2 border border-border/40 bg-background/40 shadow-sm transition-all hover:bg-background/60 hover:border-border/60 ${
            isHistoricalMode
              ? "text-warning hover:text-warning/80 ring-1 ring-warning/20"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {isHistoricalMode ? (
              <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <History className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
            )}
            <span className="truncate text-[11px] font-medium tabular-nums tracking-tight">
              {viewingSession ? formatDateTime(viewingSession.created_at) : "---"}
            </span>
          </div>
          <ChevronDown
            className={`w-3 h-3 opacity-40 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </Tooltip>

      {isOpen &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed bg-popover/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
            style={{
              position: "fixed",
              top: dropdownPosition.top + 6,
              left: dropdownPosition.left,
              zIndex: 99999,
              width: 260,
            }}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-muted/20 border-l-2 border-transparent">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground tracking-tight">
                <History className="w-3.5 h-3.5" />
                {t("session.history", { defaultValue: "Session History" })}
              </div>
              <div className="flex items-center gap-1.5">
                {hasHistoricalSessions && (
                  <Tooltip content={t("session.clear_all", { defaultValue: "Clear All History" })}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleClearAll}
                      disabled={isClearingAll}
                      className="h-6 w-6 text-muted-foreground hover:text-error hover:bg-error/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isClearingAll ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Eraser className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </Tooltip>
                )}
                <span className="py-0.5 px-2 rounded-full bg-border/50 text-[10px] font-mono font-medium text-muted-foreground/80">
                  {dbSessions.length}
                </span>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto">
              {loadingSessions ? (
                <div className="px-4 py-3 text-center text-muted-foreground text-ui">
                  {t("common.loading", { defaultValue: "Loading..." })}
                </div>
              ) : (
                dbSessions.map((session) => {
                  const isViewing = session.id === showSessionId;
                  const isWriting = isProxyActive && session.is_active === 1;

                  const sessionItem = (
                    <div
                      key={session.id}
                      onClick={() => handleSwitch(session.id)}
                      className={`group flex items-center gap-2 px-3 py-0.5 cursor-pointer transition-all border-l-2 ${
                        isViewing
                          ? "bg-primary/10 border-primary text-foreground"
                          : "border-transparent hover:bg-muted/40 hover:border-border/40"
                      }`}
                    >
                      <div className="flex-1 min-w-0 pl-1">
                        {" "}
                        {/* Extra padding to align content better */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[11px] font-medium tabular-nums ${isViewing ? "text-primary" : "text-foreground/85"}`}
                          >
                            {formatDateTime(session.created_at)}
                          </span>
                          {isWriting && (
                            <span className="flex h-1.5 w-1.5 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                            </span>
                          )}
                          {isViewing && !isWriting && (
                            <Check className="w-3 h-3 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] font-medium font-mono text-muted-foreground/50">
                          <div className="flex items-center gap-0.5">
                            <span className="opacity-90">
                              {session.flow_count > 0 ? session.flow_count : 0}
                            </span>
                            <span className="text-[9px] opacity-60">flows</span>
                          </div>
                          <span className="opacity-30">•</span>
                          <div className="opacity-90">{formatSize(session.total_size || 0)}</div>
                        </div>
                      </div>

                      {/* Delete button - not for writing session */}
                      {!isWriting && dbSessions.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => handleDelete(e, session)}
                          className="opacity-0 group-hover:opacity-100 hover:text-error h-5 w-5 bg-background/50 backdrop-blur shadow-sm border border-border/20"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </Button>
                      )}
                    </div>
                  );

                  if (session.description) {
                    return (
                      <Tooltip
                        key={session.id}
                        content={session.description}
                        side="left"
                        className="w-full"
                      >
                        {sessionItem}
                      </Tooltip>
                    );
                  }

                  return sessionItem;
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
