import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  Code,
  ExternalLink,
  Package,
  Power,
  RefreshCw,
  Search as SearchIcon,
  Settings,
  ShoppingBag,
  Trash2,
  User,
} from "lucide-react";
import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { usePluginSettingsStore } from "../../stores/pluginSettingsStore";
import { usePluginStore } from "../../stores/pluginStore";
import { useProxyStore } from "../../stores/proxyStore";
import { useUIStore } from "../../stores/uiStore";
import type { PluginInfo } from "../../types/plugin";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { PluginSettingsRenderer } from "../plugins/PluginSettingsRenderer";
import { SettingsSection } from "./SettingsLayout";

const PluginCard: React.FC<{ plugin: PluginInfo }> = ({ plugin }) => {
  const { t, i18n } = useTranslation();
  const { togglePlugin, uninstallPlugin } = usePluginStore();
  const { showConfirm } = useUIStore();

  // Settings Logic
  const [showSettings, setShowSettings] = React.useState(false);
  const { schemas, settings, loadSchema, loadSettings, saveSettings } = usePluginSettingsStore();
  const hasSettings = !!plugin.manifest.capabilities?.ui?.settings_schema;

  const isPython = !!plugin.manifest.capabilities?.logic?.entry || !!plugin.manifest.entry?.python;
  // Updated isUI logic: includes i18n-only plugins (language packs) as UI
  const isUI =
    !!plugin.manifest.capabilities?.ui?.entry ||
    !!plugin.manifest.entry?.ui ||
    !!plugin.manifest.capabilities?.i18n;

  React.useEffect(() => {
    if (showSettings && hasSettings) {
      const schemaPath = plugin.manifest.capabilities?.ui?.settings_schema;
      if (schemaPath) {
        loadSchema(plugin.manifest.id, schemaPath);
        loadSettings(plugin.manifest.id);
      }
    }
  }, [
    showSettings,
    hasSettings,
    plugin.manifest.id,
    loadSchema,
    loadSettings,
    plugin.manifest.capabilities?.ui?.settings_schema,
  ]);

  // I18n Resolution
  const locale = i18n.language?.split("-")[0] || "en";
  const localized = plugin.manifest.locales?.[locale];
  const displayName = localized?.name || plugin.manifest.name;
  const displayDescription =
    localized?.description || plugin.manifest.description || t("plugins.no_description");

  return (
    <div
      className={`group relative p-3 rounded-2xl border transition-all ${
        plugin.enabled
          ? "bg-card border-primary/20 shadow-lg shadow-primary/5"
          : "bg-muted/5 border-border/30 opacity-70 hover:opacity-100"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${
            plugin.enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground/40"
          }`}
        >
          <Package className="w-4.5 h-4.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-ui truncate">{displayName}</h3>
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground/60">
                v{plugin.manifest.version}
              </span>
              {plugin.enabled && (
                <span className="flex items-center gap-1 text-xs font-bold text-green-500 uppercase tracking-widest ml-1">
                  <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                  {t("plugins.running")}
                </span>
              )}
            </div>

            {/* Action Buttons - Horizontal Row */}
            <div className="flex items-center gap-1.5">
              {hasSettings && (
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                    showSettings
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                  title={t("common.settings", "Settings")}
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                onClick={() => togglePlugin(plugin.manifest.id, !plugin.enabled)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                  plugin.enabled
                    ? "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                title={plugin.enabled ? t("plugins.disable") : t("plugins.enable")}
              >
                <Power className={`w-3.5 h-3.5 ${plugin.enabled ? "text-green-500" : ""}`} />
              </button>

              <button
                onClick={() => {
                  showConfirm({
                    title: t("plugins.uninstall"),
                    message: t("plugins.confirm_uninstall"),
                    variant: "danger",
                    onConfirm: () => uninstallPlugin(plugin.manifest.id),
                  });
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all bg-muted/30 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={t("plugins.uninstall")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <p className="text-ui text-muted-foreground/80 line-clamp-2 leading-relaxed mb-2 pr-2">
            {displayDescription}
          </p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {plugin.manifest.author && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground/60 font-medium">
                <User className="w-3 h-3" />
                <span>
                  {typeof plugin.manifest.author === "string"
                    ? plugin.manifest.author
                    : plugin.manifest.author.name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground/60 font-medium">
              <Code className="w-3 h-3" />
              <span className="flex gap-1">
                {isPython && (
                  <span className="px-1 py-0.5 rounded bg-muted/50 border border-border/50">
                    Python
                  </span>
                )}
                {isUI && (
                  <span className="px-1 py-0.5 rounded bg-muted/50 border border-border/50">
                    UI
                  </span>
                )}
              </span>
            </div>
            {plugin.manifest.homepage && (
              <a
                href={plugin.manifest.homepage}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                <ExternalLink className="w-3 h-3" />
                <span>{t("plugins.redesign.homepage")}</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Settings Area */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-3 border-t border-border/20 px-1">
              {schemas[plugin.manifest.id] ? (
                <PluginSettingsRenderer
                  schema={schemas[plugin.manifest.id]}
                  data={settings[plugin.manifest.id] || {}}
                  onChange={(newData) => saveSettings(plugin.manifest.id, newData)}
                  pluginId={plugin.manifest.id}
                  i18nNamespace={plugin.manifest.capabilities?.i18n?.namespace}
                />
              ) : (
                <div className="flex items-center justify-center py-6">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground/30" />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const PluginSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const plugins = usePluginStore((state) => state.plugins);
  const loading = usePluginStore((state) => state.loading);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);
  const installPluginLocal = usePluginStore((state) => state.installPluginLocal);
  const setMarketOpen = useUIStore((state) => state.setMarketOpen);
  const { running, restartProxy } = useProxyStore();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [showLoading, setShowLoading] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);

  const handleRestartEngine = async () => {
    setRestarting(true);
    try {
      await restartProxy();
    } finally {
      setRestarting(false);
    }
  };

  // Stabilize loading state to prevent flash
  React.useEffect(() => {
    let timer: any;
    if (loading) {
      timer = setTimeout(() => setShowLoading(true), 250);
    } else {
      setShowLoading(false);
    }
    return () => clearTimeout(timer);
  }, [loading]);

  // Sorting & Filtering Logic
  const sortedPlugins = React.useMemo(() => {
    return [...plugins]
      .filter((p) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        const localized = p.manifest.locales?.[i18n.language?.split("-")[0]];
        const name = (localized?.name || p.manifest.name).toLowerCase();
        const desc = (localized?.description || p.manifest.description || "").toLowerCase();
        return (
          name.includes(query) ||
          desc.includes(query) ||
          p.manifest.id.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        // 1. Enabled First
        if (a.enabled !== b.enabled) {
          return a.enabled ? -1 : 1;
        }
        // 2. Alphabetical
        const nameA = (
          a.manifest.locales?.[i18n.language?.split("-")[0]]?.name || a.manifest.name
        ).toLowerCase();
        const nameB = (
          b.manifest.locales?.[i18n.language?.split("-")[0]]?.name || b.manifest.name
        ).toLowerCase();
        return nameA.localeCompare(nameB);
      });
  }, [plugins, searchQuery, i18n.language]);

  const handleInstallLocal = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "RelayCraft Plugin", extensions: ["rcplugin", "zip"] }],
    });
    if (selected && typeof selected === "string") {
      await installPluginLocal(selected);
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t("plugins.title")}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleInstallLocal}>
              <Archive className="h-4 w-4 mr-1" /> {t("plugins.install_local")}
            </Button>
            <Button size="sm" onClick={() => setMarketOpen(true, "plugin")}>
              <ShoppingBag className="h-4 w-4 mr-1" /> {t("plugins.browse_market")}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="h-7 text-xs gap-1.5"
              onClick={() => fetchPlugins()}
              disabled={loading}
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              {t("plugins.empty.rescan")}
            </Button>
          </div>
        }
      >
        <div className="p-4 space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
            <Input
              placeholder={t("plugins.search_placeholder", "Search installed plugins...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-muted/20 border-border/40 text-xs h-9 rounded-xl"
            />
          </div>

          {showLoading && plugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/40 gap-4">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                {t("plugins.scanning")}
              </span>
            </div>
          ) : sortedPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center border-2 border-dashed border-border/40 rounded-3xl bg-muted/5 gap-3">
              <div className="w-16 h-16 rounded-3xl bg-muted/20 flex items-center justify-center text-muted-foreground/30">
                <Package className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-muted-foreground/80">
                  {searchQuery ? t("common.no_results") : t("plugins.empty.title")}
                </h4>
                <p className="text-ui text-muted-foreground/50 max-w-[200px] mx-auto leading-relaxed">
                  {searchQuery ? t("common.try_another_search") : t("plugins.empty.desc")}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              <AnimatePresence mode="popLayout">
                {sortedPlugins.map((plugin) => (
                  <PluginCard key={plugin.manifest.id} plugin={plugin} />
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="mt-4 p-4 bg-primary/5 border border-primary/10 rounded-2xl flex gap-3">
            <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="text-ui text-primary font-bold uppercase tracking-widest">
                {t("plugins.guide.title")}
              </h5>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <Trans
                  i18nKey="plugins.guide.desc"
                  components={{
                    span: <span className="font-bold text-primary" />,
                  }}
                />
              </p>
              {running && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={handleRestartEngine}
                  disabled={restarting}
                  className="h-7 px-3 gap-1.5 text-xs border-primary/40 text-primary hover:bg-primary/10 hover:border-primary/60"
                >
                  <RefreshCw className={`w-3 h-3 ${restarting ? "animate-spin" : ""}`} />
                  {restarting
                    ? t("settings.network.restarting")
                    : t("settings.network.restart_now")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
};
