import { save } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { FileDown, FileUp, FolderOpen, Plus, Save, Search, Trash2 } from "lucide-react";
import { Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { CommandCenter } from "./components/ai/CommandCenter";
// UI Components
import { Button } from "./components/common/Button";
import { Input } from "./components/common/Input";
import { Tooltip } from "./components/common/Tooltip";
import { ComposerView } from "./components/composer/ComposerView";
import { GlobalModals } from "./components/layout/GlobalModals";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
// Components
import { TitleBar } from "./components/layout/TitleBar";
import { NotificationCenter } from "./components/notifications/NotificationCenter";
import { PluginPageWrapper } from "./components/plugins/PluginPageWrapper";
import { RuleView } from "./components/rules/RuleView";
import { ScriptManager } from "./components/scripts/ScriptManager";
import { CertificateSettings } from "./components/settings/CertificateSettings";
import { PluginSettings } from "./components/settings/PluginSettings";
import { SettingsView } from "./components/settings/SettingsView";
import { SessionSwitcher } from "./components/traffic/SessionSwitcher";
import { TrafficView } from "./components/traffic/TrafficView";
// Hooks
import { useAppInit } from "./hooks/useAppInit";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useGlobalScrollbar } from "./hooks/useGlobalScrollbar";
// Libs
import { notify } from "./lib/notify";
import { usePluginPageStore } from "./stores/pluginPageStore";
import { useProxyStore } from "./stores/proxyStore";
import { useRuleStore } from "./stores/ruleStore";
import { useScriptStore } from "./stores/scriptStore";
// Stores
import { useSessionStore } from "./stores/sessionStore";
import { useTrafficStore } from "./stores/trafficStore";
import { useUIStore } from "./stores/uiStore";

// Styles
import "./plugins/api";
import "./i18n";

function App() {
  const { t } = useTranslation();
  const isMacOS = useUIStore((state) => state.isMac);
  const [showExitModal, setShowExitModal] = useState(false);

  // Initialize App (Config, AI, Rules, Scripts, etc.)
  useAppInit({ setShowExitModal });
  useAppShortcuts();
  useGlobalScrollbar();

  // Proxy Control State
  const [loading, setLoading] = useState(false);
  const toggleLock = useRef(false);
  const { active, startProxy, stopProxy } = useProxyStore();

  // Header Logic State
  const { activeTab } = useUIStore();
  const { searchQuery, setSearchQuery } = useRuleStore();
  const { setImportModalOpen } = useUIStore();
  const pluginPages = usePluginPageStore((state) => state.pages);

  const handleToggleProxy = async () => {
    if (loading || toggleLock.current) return;

    toggleLock.current = true;
    setLoading(true);
    try {
      if (active) {
        await stopProxy();
        notify.success(t("titlebar.stopped"), {
          title: t("sidebar.traffic"),
          toastOnly: true,
        });
      } else {
        await startProxy();
        notify.success(t("titlebar.running"), {
          title: t("sidebar.traffic"),
          toastOnly: true,
        });
      }
    } catch (error) {
      console.error("Error toggling proxy:", error);
      notify.error(String(error), t("common.error"));
    } finally {
      requestAnimationFrame(() => {
        setLoading(false);
        toggleLock.current = false;
      });
    }
  };

  const handleExportRules = async () => {
    try {
      const path = await save({
        filters: [
          {
            name: "ZIP Bundle",
            extensions: ["zip"],
          },
        ],
        defaultPath: `relaycraft-rules-${new Date().toISOString().split("T")[0]}.zip`,
      });

      if (!path) return;

      if (path.toLowerCase().endsWith(".zip")) {
        const result = await useRuleStore.getState().exportRulesZip(path);
        if (result.success) {
          notify.success(t("rules.export_zip_success", { path }), t("sidebar.rules"));
        } else {
          notify.error(result.error || "Export Failed", t("common.error"));
        }
      }
    } catch (err) {
      console.error("Failed to export rules:", err);
      notify.error(t("traffic.proxy_error", { error: String(err) }), t("common.error"));
    }
  };

  // Subtle, drifting color blobs for premium aesthetics
  const VibrancyBackground = () => (
    <div className="bg-vibrancy-container">
      <div
        className="vibrancy-blob bg-primary/20 -top-[10%] -left-[10%] animate-vibrancy-drift"
        style={{ animationDuration: "45s" }}
      />
      <div
        className="vibrancy-blob bg-purple-500/10 top-[20%] -right-[5%] animate-vibrancy-drift"
        style={{ animationDuration: "60s", animationDelay: "-10s" }}
      />
      <div
        className="vibrancy-blob bg-blue-400/10 -bottom-[10%] left-[15%] animate-vibrancy-drift"
        style={{ animationDuration: "50s", animationDelay: "-20s" }}
      />
      {/* Noise Texture Overlay */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay"
        style={{ backgroundImage: 'url("/noise.svg")' }}
      />
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden font-sans">
      <VibrancyBackground />
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          unstyled: true,
          className: "relaycraft-toast",
          classNames: {
            toast: "relaycraft-toast-container",
            title: "relaycraft-toast-title",
            description: "relaycraft-toast-description",
            closeButton: "relaycraft-toast-close",
          },
        }}
      />

      <NotificationCenter />
      <CommandCenter />
      <TitleBar running={active} loading={loading} onToggle={handleToggleProxy} />

      <div className="flex-1 flex pt-10 overflow-hidden relative">
        <Sidebar isMacOS={isMacOS} />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background/30 backdrop-blur-sm relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* Context Header - Glassy */}
              <div className="h-11 px-4 border-b border-border/40 flex items-center justify-between bg-muted/20 backdrop-blur-xl flex-shrink-0">
                <div>
                  <h1 className="text-system font-bold tracking-tight text-foreground/90">
                    {activeTab === "traffic" && t("sidebar.traffic")}
                    {activeTab === "composer" && t("composer.title")}
                    {activeTab === "rules" && t("sidebar.rules")}
                    {activeTab === "scripts" && t("sidebar.scripts")}
                    {activeTab === "settings" && t("sidebar.settings")}
                    {/* Plugin Page Title */}
                    {(() => {
                      const page = pluginPages.find((p) => p.id === activeTab);
                      if (!page) return null;
                      return page.nameKey
                        ? t(page.nameKey, {
                            ns: page.i18nNamespace || page.pluginId,
                          })
                        : page.name;
                    })()}
                  </h1>
                </div>

                {/* Traffic Actions */}
                {activeTab === "traffic" && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center border border-border/40 rounded-lg bg-background/40 p-0.5 shadow-sm">
                      <Tooltip content={t("common.save")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => useUIStore.getState().setSaveSessionModalOpen(true)}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("common.open")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => useSessionStore.getState().loadSession()}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                      <div className="w-px h-3 bg-border/40 mx-0.5" />
                      <Tooltip content={t("common.export_har")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => useSessionStore.getState().exportHar()}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <FileUp className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("common.import_har_hint")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => useSessionStore.getState().importHar()}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                    </div>

                    <div className="w-px h-4 bg-border/40 mx-1" />

                    <Tooltip content={t("common.clear")} side="bottom">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => useTrafficStore.getState().clearFlows()}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </Tooltip>

                    {/* Session Switcher */}
                    <SessionSwitcher />
                  </div>
                )}

                {/* Rule Management Actions in Title Area */}
                {activeTab === "rules" && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        type="text"
                        placeholder={t("common.search")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-48 pl-8 pr-3 h-8 bg-background border border-border rounded text-system placeholder:text-xs placeholder:text-muted-foreground/60 focus-visible:ring-primary/20"
                      />
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        const { isEditorDirty, selectRule, setDraftRule } = useRuleStore.getState();
                        const { showConfirm } = useUIStore.getState();

                        const createNewRule = () => {
                          selectRule(null);
                          setDraftRule({});
                        };

                        if (isEditorDirty) {
                          showConfirm({
                            title: t("rules.alerts.discard_title"),
                            message: t("rules.alerts.discard_msg"),
                            variant: "warning",
                            onConfirm: createNewRule,
                          });
                        } else {
                          createNewRule();
                        }
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t("rules.new")}
                    </Button>

                    <div className="flex items-center border border-border/40 rounded-lg bg-background/40 p-0.5 shadow-sm">
                      <Tooltip content={t("common.export")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={handleExportRules}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <FileUp className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content={t("common.import")} side="bottom">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setImportModalOpen(true)}
                          className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                )}

                {/* Script Management Actions in Title Area */}
                {activeTab === "scripts" && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        const defaultTemplate = `"""\nAddon Script for RelayCraft\n"""\nfrom mitmproxy import http, ctx\n\nclass Addon:\n    def request(self, flow: http.HTTPFlow):\n        # TODO: Add your logic\n        pass\n\naddons = [Addon()]\n`;
                        useScriptStore.getState().selectScript(null);
                        useScriptStore.getState().setDraftScript({
                          name: "Untitled Script.py",
                          content: defaultTemplate,
                        });

                        useUIStore.getState().setActiveTab("scripts");
                      }}
                      className="gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t("scripts.create_script")}
                    </Button>
                  </div>
                )}
              </div>

              {/* Tab Content - Wrapped in Suspense for lazy loading */}
              <div className="flex-1 overflow-hidden relative">
                <Suspense fallback={null}>
                  {activeTab === "traffic" && <TrafficView onToggleProxy={handleToggleProxy} />}

                  {activeTab === "rules" && <RuleView />}

                  {activeTab === "scripts" && <ScriptManager />}

                  {activeTab === "composer" && <ComposerView />}

                  {activeTab === "settings" && <SettingsView />}

                  {activeTab === "plugins" && (
                    <div className="h-full overflow-hidden">
                      <PluginSettings />
                    </div>
                  )}
                  {activeTab === "certificate" && <CertificateSettings />}

                  {/* Plugin Pages */}
                  {pluginPages.map(
                    (page) =>
                      activeTab === page.id && (
                        <div key={page.id} className="h-full w-full overflow-hidden">
                          <PluginPageWrapper pluginId={page.pluginId} component={page.component} />
                        </div>
                      ),
                  )}
                </Suspense>
              </div>
            </motion.div>
          </AnimatePresence>

          <StatusBar />
        </div>
      </div>

      <GlobalModals showExitModal={showExitModal} setShowExitModal={setShowExitModal} />
    </div>
  );
}

export default App;
