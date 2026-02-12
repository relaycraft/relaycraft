import { AnimatePresence, motion } from "framer-motion";
import { Activity, Bell, BellOff, Database, Globe, Octagon, Server } from "lucide-react";
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
  const { running, port } = useProxyStore();
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

  return (
    <div className="h-7 bg-primary/5 border-t border-border flex items-center justify-between px-3 text-xs select-none relative z-50">
      <div className="flex items-center gap-4">
        {/* Plugin Slot: Left */}
        {renderSlot(PLUGIN_SLOTS.STATUS_BAR_LEFT)}

        {/* Proxy Status Icon */}
        <Tooltip content={running ? t("status_bar.listening") : t("status_bar.stopped")}>
          <div className="flex items-center justify-center w-6 overflow-visible">
            <AnimatePresence mode="wait">
              {running ? (
                <motion.div
                  key="running"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-green-500 filter drop-shadow-[0_0_2px_rgba(34,197,94,0.6)]"
                >
                  <div className="relative">
                    <div className="absolute inset-0 bg-green-500 rounded-full blur-[4px] opacity-20 animate-pulse" />
                    <Activity className="w-3.5 h-3.5 relative z-10" />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="stopped"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-muted-foreground/30"
                >
                  <Activity className="w-3.5 h-3.5" />
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
            <Tooltip content={t("status_bar.breakpoints")}>
              <div className="relative">
                <div
                  onClick={() => setShowBreakpoints(!showBreakpoints)}
                  className={`breakpoint-manager-trigger flex items-center gap-1.5 transition-colors cursor-pointer select-none rounded-[6px] px-2 py-0.5 ${showBreakpoints ? "bg-red-500/10 text-red-500 ring-1 ring-red-500/20" : "text-red-500/80 hover:text-red-500 hover:bg-red-500/5"}`}
                >
                  <Octagon className="w-3 h-3 fill-current opacity-20" />
                  <span className="font-bold font-mono">{breakpoints.length}</span>
                </div>

                <AnimatePresence>
                  {showBreakpoints && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="breakpoint-manager-container absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-64 z-[60] shadow-2xl rounded-2xl overflow-hidden border border-red-500/20 bg-background/95 backdrop-blur-xl"
                    >
                      <BreakpointManager variant="minimal" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Tooltip>
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
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full ring-1 ring-background" />
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
