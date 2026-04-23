import { useEffect } from "react";

interface UseWSRefreshOptions {
  activeTab: string;
  isWebsocket: boolean;
  autoRefresh: boolean;
  refresh: () => Promise<void>;
}

export function useWSRefresh({
  activeTab,
  isWebsocket,
  autoRefresh,
  refresh,
}: UseWSRefreshOptions) {
  useEffect(() => {
    if (activeTab !== "messages") return;
    if (!isWebsocket) return;
    if (!autoRefresh) return;

    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 500);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeTab, isWebsocket, autoRefresh, refresh]);
}
