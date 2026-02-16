import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, Play, Search, Sparkles, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCommandStore } from "../../stores/commandStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import { AppLogo } from "./AppLogo";

interface TitleBarProps {
  running?: boolean;
  loading?: boolean;
  onToggle?: () => void;
}

export function TitleBar({ running, loading, onToggle }: TitleBarProps) {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const isMacOS = useUIStore((state) => state.isMac);

  useEffect(() => {
    const checkMaximized = async () => {
      const win = getCurrentWindow();
      setIsMaximized(await win.isMaximized());
    };

    checkMaximized();

    const unlisten = getCurrentWindow().listen("tauri://resize", checkMaximized);

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
      setIsMaximized(false);
    } else {
      await win.maximize();
      setIsMaximized(true);
    }
  };

  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  return (
    <div
      onDoubleClick={handleMaximize}
      data-tauri-drag-region
      className="h-10 bg-background/95 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-3 select-none fixed top-0 left-0 right-0 z-50 cursor-default"
    >
      {!isMacOS && (
        <div className="flex items-center gap-2 pointer-events-none" data-tauri-drag-region>
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <AppLogo size={18} showText={true} />
          </div>
        </div>
      )}
      {isMacOS && <div className="w-20" />}

      {/* AI Command Center Entry (VSCode style) */}
      <div
        className="flex-1 flex justify-center max-w-2xl px-8 h-full items-center"
        data-tauri-drag-region
      >
        <button
          onClick={() => useCommandStore.getState().setIsOpen(true)}
          onMouseDown={(e) => e.stopPropagation()}
          className="group relative w-full h-7 flex items-center gap-3 px-3 rounded-lg bg-muted/40 hover:bg-muted/60 border border-border/40 hover:border-border transition-all duration-200"
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
          <div className="flex-1 text-left text-xs text-muted-foreground/60 group-hover:text-foreground/80 transition-colors font-medium">
            {t("titlebar.search_placeholder", {
              hotkey: isMacOS ? "⌘K" : "Ctrl+K",
            })}
          </div>
          <div className="flex items-center gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
            <Sparkles className="w-3 h-3 text-primary animate-pulse" />
          </div>
        </button>
      </div>

      <div className="flex items-center gap-3 w-56 justify-end" data-tauri-drag-region>
        {/* Proxy Controls */}
        <div className="flex items-center" onMouseDown={(e) => e.stopPropagation()}>
          {onToggle && (
            <Tooltip
              content={
                <span>
                  {running ? t("titlebar.stop_proxy") : t("titlebar.start_proxy")}{" "}
                  <span className="text-xs opacity-50 ml-1">⌘\</span>
                </span>
              }
            >
              <Button
                onClick={onToggle}
                disabled={loading}
                variant={running ? "destructive" : "secondary"}
                size="xs"
                className={`gap-1.5 h-7 min-w-[72px] relative overflow-hidden transition-all duration-300 rounded-lg ${
                  running
                    ? "bg-green-500/10 hover:bg-destructive/10 text-green-500 hover:text-destructive border-green-500/20 hover:border-destructive/30 border shadow-sm"
                    : "font-bold px-3 opacity-80 hover:opacity-100"
                }`}
              >
                {running && (
                  <div className="absolute inset-0 bg-green-500/5 animate-pulse pointer-events-none" />
                )}
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : running ? (
                  <Square className="w-2.5 h-2.5 fill-current" />
                ) : (
                  <Play className="w-2.5 h-2.5 fill-current" />
                )}
                <span className="text-xs font-bold tracking-tight">
                  {loading
                    ? `${running ? t("titlebar.stop_proxy") : t("titlebar.start_proxy")}...`
                    : running
                      ? t("titlebar.running")
                      : t("titlebar.stopped")}
                </span>
              </Button>
            </Tooltip>
          )}
        </div>

        {!isMacOS && (
          <div className="flex items-center h-full">
            {/* Subtle Separator */}
            <div className="w-[1px] h-3 bg-white/5 mx-1" />

            <div className="flex items-center" onMouseDown={(e) => e.stopPropagation()}>
              <Tooltip content={t("titlebar.minimize")} side="bottom">
                <button
                  className="h-8 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  onClick={handleMinimize}
                  aria-label={t("titlebar.minimize")}
                >
                  <svg
                    width="10"
                    height="1"
                    viewBox="0 0 10 1"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    role="img"
                  >
                    <title>{t("titlebar.minimize")}</title>
                    <rect width="10" height="1" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>

              <Tooltip
                content={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
                side="bottom"
              >
                <button
                  className="h-8 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                  onClick={handleMaximize}
                  aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
                >
                  {isMaximized ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      role="img"
                    >
                      <title>{t("titlebar.restore")}</title>
                      {/* Restore icon with slight rounding */}
                      <path
                        d="M3.5 1H8.5C8.77614 1 9 1.22386 9 1.5V6.5C9 6.77614 8.77614 7 8.5 7H7"
                        stroke="currentColor"
                        strokeWidth="1"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      <rect
                        x="1"
                        y="3"
                        width="6"
                        height="6"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1"
                      />
                    </svg>
                  ) : (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      role="img"
                    >
                      <title>{t("titlebar.maximize")}</title>
                      {/* Maximize icon with slight rounding */}
                      <rect
                        x="1.5"
                        y="1.5"
                        width="7"
                        height="7"
                        rx="1"
                        stroke="currentColor"
                        strokeWidth="1"
                      />
                    </svg>
                  )}
                </button>
              </Tooltip>

              <Tooltip content={t("titlebar.close")} side="bottom">
                <button
                  className="h-8 w-12 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-red-500 transition-colors"
                  onClick={handleClose}
                  aria-label={t("titlebar.close")}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    role="img"
                  >
                    <title>{t("titlebar.close")}</title>
                    <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
