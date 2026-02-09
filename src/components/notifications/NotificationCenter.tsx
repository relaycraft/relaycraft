import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, CheckCheck, Eraser, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../../stores/notificationStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import { NotificationItemCard } from "./NotificationItemCard";

export function NotificationCenter() {
  const {
    isOpen,
    setIsOpen,
    notifications,
    getFilteredNotifications,
    markAllAsRead,
    clearAll,
    markAsRead,
    removeNotification,
    dnd,
    toggleDnd,
    searchQuery,
    setSearchQuery,
  } = useNotificationStore();

  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filteredNotifications = getFilteredNotifications();

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure animation starts/DOM is ready
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle Cmd+F when notification center is open
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node) && isOpen) {
        const target = event.target as HTMLElement;
        if (target.closest("[data-notification-toggle]")) return;
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, setIsOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed top-10 bottom-7 left-0 right-0 bg-background/20 backdrop-blur-[1px] z-[80]"
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-10 right-0 bottom-7 w-[380px] bg-card/95 backdrop-blur-2xl border-l border-border/40 shadow-2xl z-[90] flex flex-col"
          >
            {/* Header */}
            <div className="h-14 px-4 border-b border-border/40 flex items-center justify-between bg-muted/10">
              <div className="flex items-center gap-2.5">
                <Tooltip
                  content={
                    dnd
                      ? t("notifications.enable", "Enable notifications")
                      : t("notifications.disable", "Disable notifications")
                  }
                  side="bottom"
                >
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleDnd}
                    className={`h-7 w-7 ${dnd ? "text-muted-foreground" : "text-primary"}`}
                  >
                    {dnd ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                  </Button>
                </Tooltip>
                <div>
                  <h2 className="font-bold text-sm">{t("notifications.title", "Notifications")}</h2>
                  <p className="text-[10px] text-muted-foreground">
                    {t("notifications.count", { count: notifications.length })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {filteredNotifications.length > 0 && (
                  <>
                    <Tooltip
                      content={t("notifications.mark_all_read", "Mark all as read")}
                      side="bottom"
                    >
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={markAllAsRead}
                        className="h-7 w-7"
                      >
                        <CheckCheck className="w-4 h-4 text-muted-foreground hover:text-primary" />
                      </Button>
                    </Tooltip>
                    <Tooltip
                      content={t("notifications.clear_all", "Clear all notifications")}
                      side="bottom"
                    >
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={clearAll}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Eraser className="w-4 h-4" />
                      </Button>
                    </Tooltip>
                  </>
                )}
                <div className="ml-0.5 pl-1 border-l border-border/50">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setIsOpen(false)}
                    className="h-7 w-7"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            {/* Search */}
            <div className="px-4 py-2 border-b border-border/50 bg-muted/5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("common.search", "Search...")}
                  className="w-full h-8 pl-8 pr-3 bg-muted/40 border border-border/40 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/50 hover:bg-muted/60 hover:border-border/60 focus:bg-background focus:border-primary/30"
                />
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredNotifications.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground/30 gap-4">
                  <div className="relative">
                    <Bell className="w-16 h-16 stroke-[1]" />
                    <div className="absolute top-0 right-0 w-3 h-3 bg-primary/20 rounded-full blur-sm animate-pulse" />
                  </div>
                  <div className="text-center">
                    <p className="text-system font-semibold text-muted-foreground/50 tracking-tight">
                      {t("notifications.empty", "No notifications")}
                    </p>
                    <p className="text-[11px] mt-1 opacity-60">
                      {t("notifications.all_processed", "You are all caught up")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {filteredNotifications.map((item) => (
                      <NotificationItemCard
                        key={item.id}
                        notification={item}
                        onMarkAsRead={markAsRead}
                        onRemove={removeNotification}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
