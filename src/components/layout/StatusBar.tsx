import { AnimatePresence, motion } from "framer-motion";
import { Bell, BellOff, Database, Globe, Server, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { version as APP_VERSION } from "../../../package.json";
import { useBreakpointStore } from "../../stores/breakpointStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { PLUGIN_SLOTS, usePluginSlotStore } from "../../stores/pluginSlotStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { Tooltip } from "../common/Tooltip";
import { BreakpointManager } from "../traffic/BreakpointManager";

export function StatusBar() {
  const { running, active, port } = useProxyStore();
  const { indices } = useTrafficStore();
  const { breakpoints } = useBreakpointStore();
  const [showBreakpoints, setShowBreakpoints] = useState(false);
  const { t } = useTranslation();
  const { isOpen, setIsOpen, unreadCount, dnd } = useNotificationStore();
  const unread = unreadCount();

  // Plugin Slots
  const slots = usePluginSlotStore((state) => state.slots);

  const renderSlot = (slotId: string) => {
    const componentList = slots[slotId] || [];
    return componentList.map((item) => <item.component key={item.id} />);
  };

  // Close on click outside
  useEffect(() => {
    if (!showBreakpoints) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !(
          target.closest(".breakpoint-manager-trigger") ||
          target.closest(".breakpoint-manager-container")
        )
      ) {
        setShowBreakpoints(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showBreakpoints]);

  // Engine health status - shows running state (engine process health)
  // active state is shown in TitleBar, this is for engine health only
  const getEngineStatus = () => {
    if (running && active) {
      return {
        status: "healthy",
        color: "text-success",
        tooltip: t("status_bar.engine_healthy", "Engine healthy, capturing"),
      };
    }
    if (running && !active) {
      return {
        status: "idle",
        color: "text-muted-foreground/50",
        tooltip: t("status_bar.engine_idle", "Engine idle"),
      };
    }
    return {
      status: "error",
      color: "text-error",
      tooltip: t("status_bar.engine_error", "Engine not running"),
    };
  };

  const engineStatus = getEngineStatus();

  return (
    <div className="h-7 bg-primary/5 border-t border-border flex items-center justify-between px-3 text-xs select-none relative z-50">
      <div className="flex items-center gap-4">
        {/* Plugin Slot: Left */}
        {renderSlot(PLUGIN_SLOTS.STATUS_BAR_LEFT)}

        {/* Engine Health Status - shows running state */}
        <Tooltip content={engineStatus.tooltip}>
          <div className="flex items-center justify-center w-6 overflow-visible">
            <AnimatePresence mode="wait">
              {running ? (
                <motion.div
                  key="running"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={engineStatus.color}
                >
                  <div className="relative">
                    {active && (
                      <div className="absolute inset-0 bg-success rounded-full blur-[4px] opacity-20 animate-pulse" />
                    )}
                    <Zap className="w-3.5 h-3.5 relative z-10" />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="stopped"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-error"
                >
                  <div className="relative">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Tooltip>

        <div className="w-px h-3 bg-border/40 ml-1 mr-2" />

        {/* Port */}
        <Tooltip content={t("status_bar.port")}>
          <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-default">
            <Server className="w-3 h-3" />
            <span className="font-mono text-foreground">{port}</span>
          </div>
        </Tooltip>

        <div className="w-px h-3 bg-border/40 mx-2" />

        {/* IP Address */}
        <Tooltip content={t("status_bar.ip")}>
          <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-default">
            <Globe className="w-3 h-3" />
            <span className="font-mono text-foreground">
              {useProxyStore.getState().ipAddress || "..."}
            </span>
          </div>
        </Tooltip>

        <div className="w-px h-3 bg-border/40 mx-2" />

        {/* Request Count */}
        <Tooltip content={t("status_bar.captured")}>
          <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-default">
            <Database className="w-3 h-3" />
            <span className="font-mono text-foreground">{indices.length}</span>
          </div>
        </Tooltip>

        {/* Breakpoint Count */}
        {breakpoints.length > 0 && (
          <div className="relative flex items-center">
            <div className="w-px h-3 bg-border/40 mx-2" />
            <div className="relative flex items-center">
              <Tooltip content={t("status_bar.breakpoints")}>
                <div
                  onClick={() => setShowBreakpoints(!showBreakpoints)}
                  className={`breakpoint-manager-trigger flex items-center gap-2 transition-all cursor-pointer select-none rounded-full px-2 py-0.5 ${
                    showBreakpoints
                      ? "bg-error/10 text-error ring-1 ring-error/30 shadow-[0_0_10px_rgba(var(--error-rgb),0.2)]"
                      : "text-error/80 hover:text-error hover:bg-error/5"
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    <div className="w-2 h-2 bg-error rounded-full shadow-[0_0_8px_rgba(var(--error-rgb),0.6)]" />
                    <div className="absolute inset-0 bg-error rounded-full blur-[3px] opacity-40 animate-pulse" />
                  </div>
                  <span className="font-bold font-mono text-[11px] leading-none">
                    {breakpoints.length}
                  </span>
                </div>
              </Tooltip>

              <AnimatePresence>
                {showBreakpoints && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="breakpoint-manager-container absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-[400px] z-[60] shadow-2xl rounded-2xl overflow-hidden border border-border/40 bg-background/95 backdrop-blur-xl"
                  >
                    <BreakpointManager variant="minimal" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Plugin Slot: Center (appended to left group for now, or could be separate) */}
        {renderSlot(PLUGIN_SLOTS.STATUS_BAR_CENTER)}
      </div>

      <div className="flex items-center gap-4">
        {/* Plugin Slot: Right */}
        {renderSlot(PLUGIN_SLOTS.STATUS_BAR_RIGHT)}

        {/* Notifications */}
        <Tooltip
          content={
            dnd
              ? t("notifications.dnd_on", "Do Not Disturb On")
              : t("notifications.title", "Notifications")
          }
        >
          <div
            className={`flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none px-1.5 rounded-sm ${isOpen ? "text-foreground" : ""}`}
            onClick={() => setIsOpen(!isOpen)}
            data-notification-toggle
          >
            <div className="relative">
              {dnd ? (
                <BellOff className="w-3 h-3 text-muted-foreground/50" />
              ) : (
                <Bell className="w-3 h-3" />
              )}
              {unread > 0 && !dnd && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-error rounded-full ring-1 ring-background" />
              )}
              {unread > 0 && dnd && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-muted-foreground/50 rounded-full ring-1 ring-background" />
              )}
            </div>
          </div>
        </Tooltip>

        {/* Mock System Stats - In a real app these would come from backend */}
        {/* Removed in favor of status-plugin */}

        <div className="text-muted-foreground">RelayCraft v{APP_VERSION}</div>
      </div>
    </div>
  );
}
