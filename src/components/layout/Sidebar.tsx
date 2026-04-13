import { motion } from "framer-motion";
import * as LucideIcons from "lucide-react";
import { Braces, Layers, Package, Radar, SendHorizontal, Settings } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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

  const sidebarRef = useRef<HTMLDivElement>(null);
  const navButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [pillRect, setPillRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const navIds = useMemo(() => new Set([...menuItems.map((m) => m.id), "settings"]), [menuItems]);

  const syncActivePill = useCallback(() => {
    const root = sidebarRef.current;
    if (!root) return;
    if (!navIds.has(activeTab)) {
      setPillRect(null);
      return;
    }
    const btn = navButtonRefs.current.get(activeTab);
    if (!btn) {
      setPillRect(null);
      return;
    }
    const sr = root.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setPillRect({
      top: br.top - sr.top,
      left: br.left - sr.left,
      width: br.width,
      height: br.height,
    });
  }, [activeTab, navIds]);

  useLayoutEffect(() => {
    syncActivePill();
  }, [syncActivePill]);

  useLayoutEffect(() => {
    const root = sidebarRef.current;
    if (!root) return;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => syncActivePill());
      ro.observe(root);
    }
    window.addEventListener("resize", syncActivePill);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", syncActivePill);
    };
  }, [syncActivePill]);

  return (
    <div
      ref={sidebarRef}
      className={`relative w-16 bg-muted/40 flex flex-col items-center flex-shrink-0 z-20 border-r border-subtle shadow-[inset_-1px_0_0_rgba(255,255,255,0.01)] ${
        isMacOS ? "py-4 gap-2" : "py-6 gap-4"
      }`}
    >
      {/* Sliding pill: geometry-driven spring (no layoutId / shared layout projection) */}
      {pillRect && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute z-[1] rounded-xl border border-primary/20 bg-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
          initial={false}
          animate={{
            top: pillRect.top,
            left: pillRect.left,
            width: pillRect.width,
            height: pillRect.height,
          }}
          transition={{ type: "spring", stiffness: 520, damping: 32 }}
        />
      )}

      {isMacOS && (
        <div className="flex flex-col items-center mb-2 select-none" data-tauri-drag-region>
          <AppLogo size={32} />
        </div>
      )}
      {menuItems.map((item, menuIndex) => (
        <Tooltip
          key={item.id}
          content={
            menuIndex < 9
              ? `${item.label} (${isMacOS ? "⌘" : "Ctrl+"}${menuIndex + 1})`
              : item.label
          }
          side="right"
        >
          <button
            type="button"
            ref={(el) => {
              if (el) navButtonRefs.current.set(item.id, el);
              else navButtonRefs.current.delete(item.id);
            }}
            onClick={() => navigate(item.id as any)}
            className="relative z-10 w-10 h-10 flex items-center justify-center group"
          >
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
          type="button"
          ref={(el) => {
            if (el) navButtonRefs.current.set("settings", el);
            else navButtonRefs.current.delete("settings");
          }}
          onClick={() => navigate("settings")}
          className="relative z-10 w-10 h-10 flex items-center justify-center group mb-2"
        >
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
