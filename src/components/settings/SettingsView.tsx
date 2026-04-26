import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  Globe,
  Info,
  Package as PackageIcon,
  Palette,
  Server,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Wrench,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/uiStore";
import { AISettingsPanel } from "../ai/AISettingsPanel";
import { AboutSettings } from "./AboutSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { CertificateSettings } from "./CertificateSettings";
import { GeneralSettings } from "./GeneralSettings";
import { MarketView } from "./MarketView";
import { McpSettings } from "./McpSettings";
import { NetworkSettings } from "./NetworkSettings";
import { PluginSettings } from "./PluginSettings";
import { SettingsPage, SettingsTabButton } from "./SettingsLayout";

interface SystemInfo {
  version: string;
  platform: string;
  arch: string;
  engine: string;
  build_date: string;
}

export function SettingsView() {
  const { t } = useTranslation();
  const { settingsTab, setSettingsTab } = useUIStore();

  const [systemInfo, setSystemInfo] = React.useState<SystemInfo | null>(null);

  React.useEffect(() => {
    invoke("get_system_info")
      .then((info: any) => setSystemInfo(info))
      .catch(console.error);
  }, []);

  const tabs = [
    { id: "general", label: t("settings.general.title"), icon: SettingsIcon },
    { id: "appearance", label: t("settings.appearance.title"), icon: Palette },
    { id: "network", label: t("settings.network.title"), icon: Globe },
    { id: "mcp", label: t("mcp.title"), icon: Server },
    { id: "ai", label: t("ai.title"), icon: Sparkles },
    { id: "plugins", label: t("plugins.title"), icon: PackageIcon },
    { id: "certificate", label: t("sidebar.certificate"), icon: Shield },
    { id: "advanced", label: t("settings.advanced.title"), icon: Wrench },
    { id: "about", label: t("settings.about.title"), icon: Info },
  ] as const;

  const sidebar = (
    <>
      {tabs.map((tab) => (
        <SettingsTabButton
          key={tab.id}
          label={tab.label}
          icon={tab.icon}
          active={settingsTab === tab.id}
          onClick={() => setSettingsTab(tab.id)}
        />
      ))}
    </>
  );

  return (
    <SettingsPage sidebar={sidebar}>
      <AnimatePresence mode="wait">
        <motion.div
          key={settingsTab}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {settingsTab === "general" && <GeneralSettings />}
          {settingsTab === "appearance" && <AppearanceSettings />}
          {settingsTab === "network" && <NetworkSettings />}
          {settingsTab === "mcp" && <McpSettings />}
          {settingsTab === "ai" && <AISettingsPanel />}
          {settingsTab === "plugins" && <PluginSettings />}
          {settingsTab === "certificate" && <CertificateSettings />}
          {settingsTab === "advanced" && <AdvancedSettings systemInfo={systemInfo} />}
          {settingsTab === "about" && <AboutSettings systemInfo={systemInfo} />}

          <div className="text-center pt-8 pb-8">
            <p className="text-xs text-muted-foreground/25 tracking-tight font-medium">
              {systemInfo
                ? `RelayCraft v${systemInfo.version} · ${systemInfo.platform} ${systemInfo.arch} · Relay Engine: ${systemInfo.engine}`
                : t("settings.footer")}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      <MarketView />
    </SettingsPage>
  );
}
