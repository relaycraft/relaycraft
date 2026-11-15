import { invoke } from "@tauri-apps/api/core";
import type { LucideIcon } from "lucide-react";
import { Globe, Plug, Server, Share2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { PERMISSION_META } from "../../plugins/permissions";
import { useAIStore } from "../../stores/aiStore";
import { usePluginStore } from "../../stores/pluginStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { SettingsTabType } from "../../stores/uiStore";
import { useUIStore } from "../../stores/uiStore";
import { AiUsageSection } from "./privacy/AiUsageSection";
import { PluginPermissionsSection } from "./privacy/PluginPermissionsSection";
import { SentToAiSection } from "./privacy/SentToAiSection";

type TileTone = "ok" | "info" | "warn" | "off";

interface ExposureTile {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  tone: TileTone;
  /** Counts toward "reachable from other devices" in the hero summary. */
  reachable: boolean;
  /** Counts toward "needs attention" in the hero summary. */
  attention: boolean;
  targetTab?: SettingsTabType;
}

const TONE_BADGE_STYLES: Record<TileTone, string> = {
  ok: "bg-green-500/10 text-green-600 dark:text-green-400",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  off: "bg-muted text-muted-foreground",
};

interface McpStatus {
  running: boolean;
  port: number;
}

function hostOf(url: string): string {
  for (const candidate of [url, `http://${url}`]) {
    try {
      return new URL(candidate).host;
    } catch {
      // try the next candidate
    }
  }
  return url;
}

/** Mirror of AIConfig::get_endpoint() on the frontend store data. */
function resolveAiEndpointHost(
  settings: {
    provider: string;
    profileId?: string;
    customEndpoint?: string;
  },
  profiles: { id: string; providerId: string; baseUrl: string }[],
): string {
  let endpoint = settings.customEndpoint?.trim() || "";
  if (!endpoint && settings.profileId) {
    endpoint =
      profiles.find((p) => p.id === settings.profileId && p.providerId === settings.provider)
        ?.baseUrl || "";
  }
  if (!endpoint) {
    const providerProfiles = profiles.filter((p) => p.providerId === settings.provider);
    const fallback = providerProfiles.find((p) => p.id.endsWith("-default")) || providerProfiles[0];
    endpoint = fallback?.baseUrl || "https://api.openai.com/v1";
  }
  return hostOf(endpoint);
}

export function PrivacySettings() {
  const { t } = useTranslation();
  const config = useSettingsStore((state) => state.config);
  const proxyRunning = useProxyStore((state) => state.running);
  const proxyPort = useProxyStore((state) => state.port);
  const aiSettings = useAIStore((state) => state.settings);
  const aiProfiles = useAIStore((state) => state.profiles);
  const plugins = usePluginStore((state) => state.plugins);
  const setSettingsTab = useUIStore((state) => state.setSettingsTab);

  const [mcpStatus, setMcpStatus] = React.useState<McpStatus | null>(null);

  React.useEffect(() => {
    let active = true;
    invoke<McpStatus>("get_mcp_status")
      .then((status) => {
        if (active) setMcpStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const share = config.share ?? {
    enabled: false,
    port: 9080,
    upstream_url: "",
    listen_lan: false,
  };
  const mcp = config.mcp_config ?? { enabled: false, port: 7090 };
  const mcpPort = mcpStatus?.port || mcp.port;

  const enabledPlugins = plugins.filter((p) => p.enabled);
  const highRiskPlugins = enabledPlugins.filter((p) =>
    (p.manifest.permissions ?? []).some(
      (permission) => PERMISSION_META[permission]?.risk === "high",
    ),
  );

  const tiles: ExposureTile[] = [
    {
      id: "proxy",
      icon: Globe,
      title: t("privacy.tiles.proxy.title"),
      detail: proxyRunning
        ? t("privacy.tiles.proxy.lan_detail", { port: proxyPort })
        : t("privacy.tiles.proxy.off"),
      tone: proxyRunning ? "info" : "off",
      reachable: proxyRunning,
      attention: false,
      targetTab: "network",
    },
    {
      id: "share",
      icon: Share2,
      title: t("privacy.tiles.share.title"),
      detail: !share.enabled
        ? t("privacy.tiles.share.off")
        : share.listen_lan
          ? t("privacy.tiles.share.lan", { port: share.port })
          : t("privacy.tiles.share.local", { port: share.port }),
      tone: !share.enabled ? "off" : share.listen_lan ? "warn" : "ok",
      reachable: share.enabled && share.listen_lan,
      attention: share.enabled && share.listen_lan,
      targetTab: "network",
    },
    {
      id: "mcp",
      icon: Server,
      title: t("privacy.tiles.mcp.title"),
      detail: mcp.enabled
        ? t("privacy.tiles.mcp.local", { port: mcpPort })
        : t("privacy.tiles.mcp.off"),
      tone: mcp.enabled ? "info" : "off",
      reachable: false,
      attention: false,
      targetTab: "mcp",
    },
    {
      id: "ssl",
      icon: ShieldAlert,
      title: t("privacy.tiles.ssl.title"),
      detail: config.ssl_insecure ? t("privacy.tiles.ssl.insecure") : t("privacy.tiles.ssl.secure"),
      tone: config.ssl_insecure ? "warn" : "ok",
      reachable: false,
      attention: config.ssl_insecure,
      targetTab: "network",
    },
    {
      id: "ai",
      icon: Sparkles,
      title: t("privacy.tiles.ai.title"),
      detail: aiSettings.enabled
        ? t("privacy.tiles.ai.sends_to", {
            host: resolveAiEndpointHost(aiSettings, aiProfiles),
          })
        : t("privacy.tiles.ai.off"),
      tone: aiSettings.enabled ? "info" : "off",
      reachable: false,
      attention: false,
      targetTab: "ai",
    },
    {
      id: "plugins",
      icon: Plug,
      title: t("privacy.tiles.plugins.title"),
      detail: t("privacy.tiles.plugins.detail", {
        enabled: enabledPlugins.length,
        high: highRiskPlugins.length,
      }),
      tone: highRiskPlugins.length > 0 ? "info" : "ok",
      reachable: false,
      attention: false,
      targetTab: "plugins",
    },
  ];

  const reachableCount = tiles.filter((tile) => tile.reachable).length;
  const attentionCount = tiles.filter((tile) => tile.attention).length;
  const allClear = reachableCount === 0 && attentionCount === 0;

  return (
    <div className="space-y-6 pb-8">
      {/* Hero */}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-br via-card to-card p-5",
          attentionCount > 0 ? "from-amber-500/10" : "from-primary/10",
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "shrink-0 p-3 rounded-xl border",
              attentionCount > 0
                ? "bg-amber-500/10 border-amber-500/20"
                : "bg-primary/10 border-primary/20",
            )}
          >
            {attentionCount > 0 ? (
              <ShieldAlert className="w-7 h-7 text-amber-500" />
            ) : (
              <ShieldCheck className="w-7 h-7 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-foreground">{t("privacy.title")}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {allClear
                ? t("privacy.hero.all_clear")
                : t("privacy.hero.summary", {
                    reachable: reachableCount,
                    attention: attentionCount,
                  })}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1.5 leading-relaxed">
              {t("privacy.hero.desc")}
            </p>
          </div>
        </div>
      </div>

      {/* Reachability tiles */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider px-3 mb-2 cursor-default select-none">
          {t("privacy.reachability.title")}
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            const clickable = !!tile.targetTab;
            return (
              <button
                key={tile.id}
                type="button"
                disabled={!clickable}
                onClick={() => tile.targetTab && setSettingsTab(tile.targetTab)}
                className={cn(
                  "text-left rounded-xl border border-border/40 bg-card p-3.5 shadow-sm transition-all",
                  clickable
                    ? "hover:border-primary/30 hover:bg-muted/30 cursor-pointer"
                    : "cursor-default",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                    <span className="text-ui font-semibold text-foreground truncate">
                      {tile.title}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 px-1.5 py-0.5 rounded-full text-tiny font-bold",
                      TONE_BADGE_STYLES[tile.tone],
                    )}
                  >
                    {t(`privacy.status.${tile.tone}`)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
                  {tile.detail}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <AiUsageSection />
      <SentToAiSection />
      <PluginPermissionsSection />
    </div>
  );
}
