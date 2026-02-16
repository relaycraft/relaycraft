import { Check, ChevronDown, Eye, History, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useProxyStore } from "../../stores/proxyStore";
import { type DbSession, useSessionStore } from "../../stores/sessionStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";

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
  } = useSessionStore();
  const { active: isProxyActive } = useProxyStore();

  const [isOpen, setIsOpen] = useState(false);
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
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Find the session that backend is actively writing to
  const writingSession = isProxyActive ? dbSessions.find((s) => s.is_active === 1) : null;
  const viewingSession = dbSessions.find((s) => s.id === showSessionId);
  // Historical mode: viewing a session that is NOT the current writing session
  // If there's no writing session, we're not in historical mode (just viewing old data)
  // Historical mode: we are viewing a session that is NOT the current writing session,
  // OR the proxy is not active at all (everything is history).
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

  if (dbSessions.length <= 1) {
    return null;
  }

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
      <Button
        variant="ghost"
        size="xs"
        onClick={toggleDropdown}
        title={
          isHistoricalMode
            ? t("session.historical_mode", { defaultValue: "Viewing historical session" })
            : writingSession
              ? t("session.switch_hint", { defaultValue: "Switch session" })
              : t("common.loading", { defaultValue: "Loading..." })
        }
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
          <span className="truncate text-small font-medium tracking-tight tabular-nums">
            {viewingSession ? formatDateTime(viewingSession.created_at) : "---"}
          </span>
        </div>
        <ChevronDown
          className={`w-3 h-3 opacity-40 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </Button>

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
            <div className="px-3 py-2 text-caption font-bold text-muted-foreground tracking-wider uppercase border-b border-border/40 bg-muted/20">
              {t("session.history", { defaultValue: "History Records" })}
              <span className="ml-2 py-0.5 px-1.5 rounded-full bg-border/40 text-caption font-mono">
                {dbSessions.length}
              </span>
            </div>

            <div className="max-h-48 overflow-y-auto">
              {loadingSessions ? (
                <div className="px-4 py-3 text-center text-muted-foreground text-small">
                  {t("common.loading", { defaultValue: "Loading..." })}
                </div>
              ) : (
                dbSessions.map((session) => {
                  const isViewing = session.id === showSessionId;
                  const isWriting = isProxyActive && session.is_active === 1;

                  return (
                    <div
                      key={session.id}
                      onClick={() => handleSwitch(session.id)}
                      className={`group flex items-center gap-3 px-3 py-2 cursor-pointer transition-all border-l-2 ${
                        isViewing
                          ? "bg-primary/5 border-primary text-foreground"
                          : "border-transparent hover:bg-muted/40 hover:border-border/40"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-small font-semibold tabular-nums ${isViewing ? "text-primary" : ""}`}
                          >
                            {formatDateTime(session.created_at)}
                          </span>
                          {isWriting && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                            </span>
                          )}
                          {isViewing && !isWriting && (
                            <Check className="w-3 h-3 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-caption text-muted-foreground mt-0.5 opacity-70">
                          <div className="flex items-center gap-1">
                            {session.flow_count > 0 ? session.flow_count : 0} flows
                          </div>
                          <span className="opacity-30">•</span>
                          <div>{formatSize(session.total_size || 0)}</div>
                        </div>
                      </div>

                      {/* Delete button - not for writing session */}
                      {!isWriting && dbSessions.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => handleDelete(e, session)}
                          className="opacity-0 group-hover:opacity-100 hover:text-error h-5 w-5"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
