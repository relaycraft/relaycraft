import { PauseCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBreakpointStore } from "../../stores/breakpointStore";
import { Tooltip } from "../common/Tooltip";

interface BreakpointManagerProps {
  variant?: "default" | "minimal";
}

export function BreakpointManager({ variant = "default" }: BreakpointManagerProps) {
  const { t } = useTranslation();
  const { breakpoints, removeBreakpoint, clearBreakpoints } = useBreakpointStore();

  const handleRemove = async (id: string) => {
    await removeBreakpoint(id);
  };

  const handleClearAll = async () => {
    await clearBreakpoints();
  };

  // Only show enabled breakpoints
  const activeBreakpoints = breakpoints.filter((b) => b.enabled);

  if (activeBreakpoints.length === 0) return null;

  const containerClass =
    variant === "default"
      ? "p-4 bg-red-500/5 border border-red-500/10 rounded-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      : "p-3 space-y-3";

  // Helper to get match type label
  const getMatchTypeLabel = (matchType: string) => {
    switch (matchType) {
      case "exact":
        return "=";
      case "regex":
        return "~/";
      default:
        return "⊃";
    }
  };

  // Helper to get phase badges
  const getPhaseBadges = (b: { breakOnRequest: boolean; breakOnResponse: boolean }) => {
    const badges = [];
    if (b.breakOnRequest) {
      badges.push(
        <span
          key="req"
          className="px-1 py-0.5 text-[9px] font-bold bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded uppercase"
        >
          {t("breakpoint.request", "Req")}
        </span>,
      );
    }
    if (b.breakOnResponse) {
      badges.push(
        <span
          key="res"
          className="px-1 py-0.5 text-[9px] font-bold bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded uppercase"
        >
          {t("breakpoint.response", "Res")}
        </span>,
      );
    }
    return badges;
  };

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-red-500/10 rounded-lg text-red-500 font-bold">
            <PauseCircle className="w-4 h-4" />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-red-500/80">
            {t("breakpoint.active_manager")} ({activeBreakpoints.length})
          </span>
        </div>
        <button
          onClick={handleClearAll}
          className="text-xs font-bold text-red-500/60 hover:text-red-500 hover:bg-red-500/10 px-2 py-1 rounded transition-all uppercase tracking-tighter"
        >
          {t("breakpoint.clear_all")}
        </button>
      </div>

      <div className="space-y-1">
        {activeBreakpoints.map((b) => (
          <div
            key={b.id}
            className="group flex items-center justify-between p-2 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {getMatchTypeLabel(b.matchType)}
              </span>
              <span className="text-xs font-mono text-foreground/80 truncate">{b.pattern}</span>
              <div className="flex items-center gap-1 flex-shrink-0">{getPhaseBadges(b)}</div>
            </div>
            <Tooltip content={t("breakpoint.remove_one")}>
              <button
                onClick={() => handleRemove(b.id)}
                className="p-1 text-muted-foreground/40 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}
