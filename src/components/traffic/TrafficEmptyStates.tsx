import type { TFunction } from "i18next";
import { Activity, Info, ListFilter, Lock, QrCode, Search, Terminal, Wifi } from "lucide-react";
import { EmptyState } from "../common/EmptyState";

interface TrafficEmptyStatesProps {
  t: TFunction;
  hasAnyIndices: boolean;
  filterText: string;
  onlyMatched: boolean;
  active: boolean;
  port: number;
  loading?: boolean;
  onClearFilter: () => void;
  onToggleProxy: () => void;
  onOpenGuide: () => void;
  onOpenCertificateSettings: () => void;
}

export function TrafficEmptyStates({
  t,
  hasAnyIndices,
  filterText,
  onlyMatched,
  active,
  port,
  loading,
  onClearFilter,
  onToggleProxy,
  onOpenGuide,
  onOpenCertificateSettings,
}: TrafficEmptyStatesProps) {
  if (hasAnyIndices) {
    return (
      <EmptyState
        icon={Search}
        title={t("traffic.empty_search")}
        description={
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
            {t("traffic.filter.current")}
            {filterText && (
              <span className="font-mono text-primary/80 bg-primary/5 px-1.5 py-0.5 rounded">
                {filterText}
              </span>
            )}
            {onlyMatched && (
              <span className="font-bold text-purple-500/80 bg-purple-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                <ListFilter className="w-3 h-3" />
                {t("traffic.filter.matched_tooltip")}
              </span>
            )}
          </div>
        }
        action={{
          label: t("common.clear_filter"),
          onClick: onClearFilter,
        }}
        animation="pulse"
      />
    );
  }

  if (!active) {
    return (
      <EmptyState
        icon={Activity}
        title={t("traffic.proxy_stopped")}
        description={t("traffic.start_hint")}
        action={{
          label: t("traffic.start_proxy"),
          onClick: onToggleProxy,
          icon: Wifi,
          isLoading: loading,
        }}
        animation="pulse"
        className="py-12"
      />
    );
  }

  return (
    <EmptyState
      icon={Wifi}
      title={t("traffic.listening")}
      description={
        <div className="space-y-6">
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-1">
            <span className="px-1.5 py-0.5 bg-muted rounded border border-border/50 font-mono">
              127.0.0.1:{port}
            </span>
            <span>•</span>
            <span className="text-primary font-medium">{t("traffic.server_status")}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/40">
            <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-left group hover:bg-muted/50 transition-all">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1 bg-blue-500/10 rounded text-blue-500">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                <span className="text-ui font-bold">{t("traffic.setup.system")}</span>
              </div>
              <p className="text-ui text-muted-foreground leading-relaxed">
                {t("traffic.setup.system_desc")}
              </p>
            </div>
            <div className="p-3 bg-muted/30 rounded-xl border border-border/40 text-left group hover:bg-muted/50 transition-all">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="p-1 bg-purple-500/10 rounded text-purple-500">
                  <QrCode className="w-3.5 h-3.5" />
                </div>
                <span className="text-ui font-bold">{t("traffic.setup.mobile")}</span>
              </div>
              <p className="text-ui text-muted-foreground leading-relaxed">
                {t("traffic.setup.mobile_desc")}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-4 pt-2">
            <button
              onClick={onOpenGuide}
              className="text-ui text-primary hover:underline flex items-center gap-1"
            >
              <Info className="w-3 h-3" />
              {t("traffic.setup.guide")}
            </button>
            <button
              onClick={onOpenCertificateSettings}
              className="text-ui text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Lock className="w-3 h-3" />
              {t("traffic.setup.cert")}
            </button>
          </div>
        </div>
      }
      animation="radar"
    />
  );
}
