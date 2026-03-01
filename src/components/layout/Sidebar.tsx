import { motion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import { Braces, Layers, Package, Radar, SendHorizontal, Settings } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "../../hooks/useNavigate";
import { usePluginPageStore } from "../../stores/pluginPageStore";
import { useUIStore } from "../../stores/uiStore";
import { IconWrapper } from "../common/IconWrapper";
import { Tooltip } from "../common/Tooltip";
import { PluginSlot } from "../plugins/PluginSlot";
import { AppLogo } from "./AppLogo";

interface SidebarProps {
  isMacOS: boolean;
}

export function Sidebar({ isMacOS }: SidebarProps) {
  const { t } = useTranslation();
  const { activeTab } = useUIStore();
  const { navigate } = useNavigate();
  const pluginPages = usePluginPageStore((state) => state.pages);

  const menuItems = useMemo(
    () => [
      { id: "traffic", icon: Radar, label: t("sidebar.traffic") },
      { id: "composer", icon: SendHorizontal, label: t("sidebar.composer") },
      { id: "rules", icon: Layers, label: t("sidebar.rules") },
      { id: "scripts", icon: Braces, label: t("sidebar.scripts") },
      ...pluginPages.map((p) => {
        let IconComponent: any = Package;
        if (typeof p.icon === "string" && p.icon) {
          const iconStr = p.icon as string;
          const iconKey = iconStr as keyof typeof LucideIcons;
          const capitalizedKey = (iconStr.charAt(0).toUpperCase() +
            iconStr.slice(1)) as keyof typeof LucideIcons;
          // biome-ignore lint/performance/noDynamicNamespaceImportAccess: Required for resolving dynamic icon strings from plugins
          const Resolved = LucideIcons[iconKey] || LucideIcons[capitalizedKey];
          if (Resolved) IconComponent = Resolved;
        } else if (p.icon) {
          IconComponent = p.icon;
        }

        const label = p.nameKey ? t(p.nameKey, { ns: p.i18nNamespace || p.pluginId }) : p.name;

        return {
          id: p.id,
          icon: IconComponent,
          label,
        };
      }),
    ],
    [t, pluginPages],
  );

  return (
    <div
      className={`w-16 bg-muted/40 flex flex-col items-center flex-shrink-0 z-20 border-r border-subtle shadow-[inset_-1px_0_0_rgba(255,255,255,0.01)] ${
        isMacOS ? "py-4 gap-2" : "py-6 gap-4"
      }`}
    >
      {isMacOS && (
        <div className="flex flex-col items-center mb-2 select-none" data-tauri-drag-region>
          <AppLogo size={32} />
        </div>
      )}
      {menuItems.map((item) => (
        <Tooltip
          key={item.id}
          content={
            menuItems.indexOf(item) < 9
              ? `${item.label} (${isMacOS ? "⌘" : "Ctrl+"}${menuItems.indexOf(item) + 1})`
              : item.label
          }
          side="right"
        >
          <button
            onClick={() => navigate(item.id as any)}
            className="relative w-10 h-10 flex items-center justify-center group"
          >
            {activeTab === item.id && (
              <motion.div
                layoutId="active-pill"
                className="absolute inset-0 bg-primary/20 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                transition={{ type: "spring", stiffness: 520, damping: 32 }}
              />
            )}

            <motion.div
              animate={{
                scale: activeTab === item.id ? 1.15 : 1,
              }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="relative z-10"
            >
              <IconWrapper
                icon={item.icon}
                active={activeTab === item.id}
                size={20}
                strokeWidth={1.4}
              />
            </motion.div>
          </button>
        </Tooltip>
      ))}

      <div className="flex-1" />

      <PluginSlot id="sidebar-bottom" className="flex flex-col items-center gap-4 py-2" />

      <Tooltip content={t("sidebar.settings")} side="right">
        <button
          onClick={() => navigate("settings")}
          className="relative w-10 h-10 flex items-center justify-center group mb-2"
        >
          {activeTab === "settings" && (
            <motion.div
              layoutId="active-pill"
              className="absolute inset-0 bg-primary/20 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
              transition={{ type: "spring", stiffness: 520, damping: 32 }}
            />
          )}

          <motion.div
            animate={{
              scale: activeTab === "settings" ? 1.15 : 1,
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="relative z-10"
          >
            <IconWrapper
              icon={Settings}
              active={activeTab === "settings"}
              size={20}
              strokeWidth={1.4}
            />
          </motion.div>
        </button>
      </Tooltip>
    </div>
  );
}
