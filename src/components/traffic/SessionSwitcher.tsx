import { Check, ChevronDown, Circle, Eye, History, Trash2 } from "lucide-react";
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
      setDropdownPosition({
        top: rect.bottom,
        left: Math.min(rect.left, window.innerWidth - 240),
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

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setIsOpen(!isOpen)}
        title={
          isHistoricalMode
            ? t("session.historical_mode", { defaultValue: "Viewing historical session" })
            : writingSession
              ? t("session.switch_hint", { defaultValue: "Switch session" })
              : t("common.loading", { defaultValue: "Loading..." })
        }
        className={`h-7 px-2 gap-1 ${
          isHistoricalMode
            ? "text-amber-600 hover:text-amber-700 bg-amber-500/10"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {isHistoricalMode ? <Eye className="w-3 h-3" /> : <History className="w-3 h-3" />}
        <span className="max-w-[100px] truncate text-[11px]">
          {viewingSession ? formatDateTime(viewingSession.created_at) : "---"}
        </span>
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </Button>

      {isOpen &&
        createPortal(
          <div
            ref={portalRef}
            className="fixed bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
            style={{
              position: "fixed",
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              zIndex: 99999,
              width: 240,
            }}
          >
            <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border bg-muted/30">
              {t("session.history", { defaultValue: "History" })} ({dbSessions.length})
            </div>

            <div className="max-h-48 overflow-y-auto">
              {loadingSessions ? (
                <div className="px-4 py-3 text-center text-muted-foreground text-[11px]">
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
                      className={`group flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors ${
                        isViewing ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {/* DateTime display */}
                          <span className="text-[11px] font-medium">
                            {formatDateTime(session.created_at)}
                          </span>
                          {/* Writing indicator (green dot) */}
                          {isWriting && (
                            <Circle className="w-2 h-2 text-green-500 fill-green-500 flex-shrink-0" />
                          )}
                          {/* Viewing checkmark */}
                          {isViewing && !isWriting && (
                            <Check className="w-2.5 h-2.5 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-muted-foreground mt-0.5">
                          <span>{session.flow_count > 0 ? session.flow_count : 0} flows</span>
                          <span className="opacity-50">•</span>
                          <span>{formatSize(session.total_size || 0)}</span>
                        </div>
                      </div>

                      {/* Delete button - not for writing session */}
                      {!isWriting && dbSessions.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => handleDelete(e, session)}
                          className="opacity-0 group-hover:opacity-100 hover:text-destructive h-5 w-5"
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
