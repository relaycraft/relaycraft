import { AlertOctagon, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logger } from "../../lib/logger";
import { useBreakpointStore } from "../../stores/breakpointStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Tooltip } from "../common/Tooltip";

interface BreakpointManagerProps {
  variant?: "default" | "minimal";
}

export function BreakpointManager({ variant = "default" }: BreakpointManagerProps) {
  const { t } = useTranslation();
  const { breakpoints, removeBreakpoint } = useBreakpointStore();
  const port = useSettingsStore.getState().config.proxy_port;

  const handleRemove = async (id: string, pattern: string) => {
    try {
      await fetch(`http://127.0.0.1:${port}/_relay/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "remove", pattern }),
        cache: "no-store",
      });
      removeBreakpoint(id);
    } catch (e) {
      console.error("Failed to remove breakpoint", e);
    }
  };

  const handleClearAll = async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/_relay/breakpoints`, {
        method: "POST",
        body: JSON.stringify({ action: "clear" }),
        cache: "no-store",
      });
      breakpoints.forEach((b) => {
        removeBreakpoint(b.id);
      });
    } catch (e) {
      Logger.error("Failed to clear breakpoints", e);
    }
  };

  if (breakpoints.length === 0) return null;

  const containerClass =
    variant === "default"
      ? "p-4 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      : "p-3 space-y-3";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-red-500/20 rounded-lg text-red-500 font-bold">
            <AlertOctagon className="w-4 h-4" />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-red-500/80">
            {t("breakpoint.active_manager")}
          </span>
        </div>
        <button
          onClick={handleClearAll}
          className="text-[10px] font-bold text-red-500/60 hover:text-red-500 hover:bg-red-500/10 px-2 py-1 rounded transition-all uppercase tracking-tighter"
        >
          {t("breakpoint.clear_all")}
        </button>
      </div>

      <div className="space-y-1">
        {breakpoints.map((b) => (
          <div
            key={b.id}
            className="group flex items-center justify-between p-2 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
          >
            <span className="text-xs font-mono text-foreground/80 truncate pr-4">{b.pattern}</span>
            <Tooltip content={t("breakpoint.remove_one")}>
              <button
                onClick={() => handleRemove(b.id, b.pattern)}
                className="p-1 text-muted-foreground/40 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-red-500/40 italic font-medium pt-1">{t("breakpoint.hint")}</p>
    </div>
  );
}
