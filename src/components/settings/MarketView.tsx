import { motion } from "framer-motion";
import {
  Check,
  Download,
  ExternalLink,
  Package,
  Palette,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { usePluginStore } from "../../stores/pluginStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";

/**
 * Compares two semantic version strings.
 * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
 */
const compareVersions = (v1: string, v2: string) => {
  const parts1 = v1.replace(/^v/, "").split(".").map(Number);
  const parts2 = v2.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
};

export const MarketView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { marketOpen, setMarketOpen, marketType } = useUIStore();
  const {
    marketPlugins,
    themeMarketPlugins,
    fetchMarketPlugins,
    fetchCachedMarketPlugins,
    isFetchingMarket,
    installPlugin,
    installingPluginUrl,
    plugins: installedPlugins,
  } = usePluginStore();

  const { themes: installedThemes, activeThemeId, setTheme } = useThemeStore();

  const [searchQuery, setSearchQuery] = useState("");

  // Select the correct data source based on market type
  const currentMarketList = marketType === "theme" ? themeMarketPlugins : marketPlugins;

  useEffect(() => {
    if (marketOpen && currentMarketList.length === 0) {
      // Determine type string for fetch
      const type = marketType === "theme" ? "theme" : "plugin";
      fetchCachedMarketPlugins(type);
    }
  }, [marketOpen, marketType, currentMarketList.length, fetchCachedMarketPlugins]);

  if (!marketOpen) return null;

  const filtered = currentMarketList.filter((item) => {
    // Localization logic
    const currentLang = i18n.language.startsWith("zh") ? "zh" : "en";
    const localeInfo = item.locales?.[currentLang] || {};
    const displayName = localeInfo.name || item.name;
    const displayDesc = localeInfo.description || item.description;

    const matchesSearch =
      (displayName || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (displayDesc || "").toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const handleSync = () => {
    const type = marketType === "theme" ? "theme" : "plugin";
    fetchMarketPlugins(type);
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/25 backdrop-blur-[1px]"
      onClick={() => setMarketOpen(false)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="w-full max-w-4xl h-[600px] max-h-[85vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-border/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-none px-6 py-4 border-b border-border bg-muted/20">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-base font-bold tracking-tight flex items-center gap-2 text-foreground/90">
                {marketType === "theme" ? (
                  <Palette className="w-4 h-4 text-primary" />
                ) : (
                  <Package className="w-4 h-4 text-primary" />
                )}
                {marketType === "theme"
                  ? t("plugins.market.title_theme")
                  : t("plugins.market.title_plugin")}
              </h2>
              <p className="text-muted-foreground text-ui leading-tight">
                {marketType === "theme" ? t("plugins.market_desc_theme") : t("plugins.market_desc")}
              </p>
            </div>
            <button
              onClick={() => setMarketOpen(false)}
              className="p-1.5 -mr-2 -mt-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <input
                type="text"
                placeholder={
                  marketType === "theme"
                    ? t("plugins.search_placeholder_theme")
                    : t("plugins.search_placeholder_plugin")
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 bg-background border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium placeholder:text-muted-foreground/50"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-ui font-medium px-3 bg-background hover:bg-muted text-muted-foreground hover:text-foreground border-border"
              onClick={handleSync}
              disabled={isFetchingMarket}
            >
              <RefreshCw className={`w-3 h-3 mr-1.5 ${isFetchingMarket ? "animate-spin" : ""}`} />
              {t("plugins.market.sync")}
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-muted/5 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/50 transition-colors">
          {isFetchingMarket && filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
              </div>
              <p className="text-xs text-muted-foreground font-medium animate-pulse">
                {t("plugins.market.loading")}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3 opacity-60">
              <div className="p-3 bg-muted/50 rounded-full">
                <Search className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                {t("plugins.market.empty_tip")}
              </p>
            </div>
          ) : (
            <div
              className={`grid gap-4 ${marketType === "theme" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-2"}`}
            >
              {filtered.map((item) => {
                // Localization
                const currentLang = i18n.language.startsWith("zh") ? "zh" : "en";
                const localeInfo = item.locales?.[currentLang] || {};
                const displayName = localeInfo.name || item.name;
                const displayDesc = localeInfo.description || item.description;

                const isInstalledPlugin = installedPlugins.some((p) => p.manifest.id === item.id);
                const isInstalledTheme = installedThemes.some((t) => t.id === item.id);

                const isThemeItem = marketType === "theme";
                const isInstalled = isThemeItem ? isInstalledTheme : isInstalledPlugin;
                const isActiveTheme = isThemeItem && activeThemeId === item.id;

                const isInstalling = installingPluginUrl === item.downloadUrl;

                if (marketType === "theme") {
                  return (
                    <div
                      key={item.id}
                      className="group relative bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg hover:border-primary/30 transition-all duration-300"
                    >
                      {/* Thumbnail Area */}
                      <div className="aspect-[16/10] bg-muted relative overflow-hidden">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={displayName}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-muted to-muted/50 p-6">
                            <Palette className="w-10 h-10 text-muted-foreground/20 mb-2" />
                            <span className="text-xs text-muted-foreground/40 font-bold uppercase tracking-widest">
                              {t("plugins.market.no_preview")}
                            </span>
                          </div>
                        )}

                        {/* Overlay Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />

                        {/* Hover Install Button */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 backdrop-blur-[2px]">
                          <Button
                            variant={
                              isInstalled && isThemeItem
                                ? isActiveTheme
                                  ? "secondary"
                                  : "outline"
                                : "default"
                            }
                            size="sm"
                            className={`h-9 px-6 font-bold shadow-xl ${isInstalled && isThemeItem && !isActiveTheme ? "bg-white/10 hover:bg-white/20 text-white border-white/20" : ""}`}
                            disabled={
                              (isInstalled && !isThemeItem) || isInstalling || isActiveTheme
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isInstalled && isThemeItem) {
                                setTheme(item.id);
                              } else {
                                installPlugin(item.downloadUrl);
                              }
                            }}
                          >
                            {isInstalling ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
                                {t("plugins.installing")}
                              </>
                            ) : isInstalled ? (
                              isThemeItem ? (
                                isActiveTheme ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 mr-2" />
                                    {t("settings.appearance.active")}
                                  </>
                                ) : (
                                  <>
                                    <Palette className="w-3.5 h-3.5 mr-2" />
                                    {t("settings.appearance.apply")}
                                  </>
                                )
                              ) : (
                                <>
                                  <Check className="w-3.5 h-3.5 mr-2" />
                                  {t("plugins.market.installed")}
                                </>
                              )
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5 mr-2" />
                                {t("plugins.market.install")}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Minimal Info */}
                      <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-bold text-sm text-white/90 leading-tight shadow-black drop-shadow-md">
                              {displayName}
                            </h3>
                            <p className="text-xs text-white/60 font-medium mt-0.5">
                              {item.author}
                            </p>
                          </div>
                          {item.downloadCount != null && (
                            <div className="flex items-center text-xs text-white/60 bg-black/30 px-1.5 py-0.5 rounded backdrop-blur-sm">
                              <Download className="w-3 h-3 mr-1 opacity-80" />
                              {item.downloadCount.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // Plugin Layout (Redesigned)
                const installedPlugin = installedPlugins.find((p) => p.manifest.id === item.id);
                const hasUpdate =
                  installedPlugin &&
                  compareVersions(item.version, installedPlugin.manifest.version) > 0;

                return (
                  <div
                    key={item.id}
                    className="group p-5 bg-card border border-border rounded-xl hover:shadow-lg hover:border-primary/20 transition-all duration-300 flex flex-col relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-300">
                          <Package className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-foreground leading-tight group-hover:text-primary transition-colors">
                              {displayName}
                            </h3>
                            <span className="text-[10px] px-1.5 py-0.5 bg-muted/50 rounded font-bold text-muted-foreground/40 border border-border/40">
                              v{item.version}
                            </span>
                            {item.homepage && (
                              <a
                                href={item.homepage}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground/30 hover:text-primary transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-micro font-bold text-muted-foreground/40 uppercase tracking-wider">
                              by {item.author}
                            </span>
                            {item.downloadCount != null && (
                              <span className="text-micro text-muted-foreground/30 flex items-center border-l border-border/40 pl-2">
                                <Download className="w-2.5 h-2.5 mr-1" />
                                {item.downloadCount.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        <Button
                          variant={isInstalled && !hasUpdate ? "ghost" : "default"}
                          size="sm"
                          disabled={(isInstalled && !hasUpdate) || isInstalling}
                          onClick={() => installPlugin(item.downloadUrl)}
                          className={`h-7 text-micro px-3 font-bold transition-all ${
                            isInstalled && !hasUpdate
                              ? "bg-muted/30 text-muted-foreground/50 cursor-default"
                              : hasUpdate
                                ? "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/10 shadow-lg"
                                : "hover:scale-105 shadow-sm hover:shadow-primary/20"
                          }`}
                        >
                          {isInstalling ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : isInstalled && !hasUpdate ? (
                            <>
                              <Check className="w-3 h-3 mr-1 opacity-60" />
                              {t("plugins.market.installed")}
                            </>
                          ) : hasUpdate ? (
                            <>
                              <RefreshCw className="w-3 h-3 mr-1" />
                              {t("common.update", { defaultValue: "Update" })}
                            </>
                          ) : (
                            <>
                              <Download className="w-3 h-3 mr-1" />
                              {t("plugins.market.install")}
                            </>
                          )}
                        </Button>
                        {hasUpdate && (
                          <span className="text-[9px] font-black text-amber-500/80 uppercase tracking-tighter">
                            New Update
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground/80 leading-relaxed line-clamp-2 pr-12">
                        {displayDesc}
                      </p>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-micro font-black uppercase tracking-tighter px-1.5 py-0.5 bg-muted/40 border border-border/20 rounded-md text-muted-foreground/40"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
};
