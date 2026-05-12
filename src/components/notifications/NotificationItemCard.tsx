import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NotificationItem } from "../../stores/notificationStore";
import { usePluginStore } from "../../stores/pluginStore";
import { Button } from "../common/Button";
import { Tooltip } from "../common/Tooltip";
import {
  extractPluginIdFromNotification,
  formatRelativeTime,
  getCategoryConfig,
  getPriorityConfig,
  stripPluginSourcePrefix,
  translateNotificationSubsystemSource,
} from "./NotificationHelpers";

interface NotificationItemCardProps {
  notification: NotificationItem;
  onMarkAsRead: (id: string) => void;
  onRemove: (id: string) => void;
}

export function NotificationItemCard({
  notification,
  onMarkAsRead,
  onRemove,
}: NotificationItemCardProps) {
  const { t } = useTranslation();
  // 提供默认值以支持旧通知
  const category = notification.category || "system";
  const priority = notification.priority || "normal";

  const pluginId = extractPluginIdFromNotification(notification);
  const resolvedPluginName = usePluginStore((s) =>
    pluginId ? s.plugins.find((p) => p.manifest.id === pluginId)?.manifest.name : undefined,
  );

  const displayTitle =
    category === "plugin" && resolvedPluginName
      ? resolvedPluginName
      : category === "plugin" && notification.title.startsWith("Plugin: ")
        ? stripPluginSourcePrefix(notification.title)
        : notification.title;

  const titleTooltip =
    pluginId && resolvedPluginName && resolvedPluginName !== pluginId
      ? t("notifications.plugin_title_tooltip", { name: resolvedPluginName, id: pluginId })
      : displayTitle;

  const rawSource = notification.source;
  const showSourceChip =
    Boolean(rawSource) && rawSource !== notification.title && rawSource !== displayTitle;

  let sourceChipLabel: string | null = null;
  if (showSourceChip && rawSource) {
    if (rawSource.startsWith("Plugin: ")) {
      const stripped = stripPluginSourcePrefix(rawSource);
      if (
        pluginId &&
        resolvedPluginName &&
        displayTitle === resolvedPluginName &&
        resolvedPluginName !== pluginId
      ) {
        sourceChipLabel = pluginId;
      } else {
        sourceChipLabel = stripped;
      }
    } else {
      sourceChipLabel = translateNotificationSubsystemSource(rawSource, t);
    }
  }

  const priorityConfig = getPriorityConfig(priority);
  const categoryConfig = getCategoryConfig(category);
  const PriorityIcon = priorityConfig.icon;
  const CategoryIcon = categoryConfig.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`relative group/notification-card p-3 rounded-xl border transition-all cursor-pointer ${
        notification.read
          ? "bg-muted/5 border-border/10 opacity-60 hover:opacity-100"
          : `${priorityConfig.className} shadow-sm border-border/40 hover:border-border/60`
      } ${priorityConfig.shouldPulse && !notification.read ? "animate-pulse" : ""}`}
      onClick={() => onMarkAsRead(notification.id)}
    >
      <div className="flex items-start gap-2.5">
        {/* 图标 */}
        <div
          className={`mt-0.5 shrink-0 ${priorityConfig.shouldPulse && !notification.read ? "animate-pulse" : ""}`}
        >
          <PriorityIcon className={`w-4 h-4 ${priorityConfig.iconClassName}`} />
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* 标题和时间 */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 pr-6">
              {!notification.read && (
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: priorityConfig.color }}
                />
              )}
              <Tooltip content={titleTooltip} side="bottom">
                <h4
                  className={`text-xs font-semibold leading-snug tracking-tight truncate ${
                    notification.read ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {displayTitle}
                </h4>
              </Tooltip>
            </div>
          </div>

          {/* 消息内容 */}
          {notification.message && (
            <Tooltip content={notification.message} multiline side="bottom" className="w-full">
              <p className="text-tiny text-muted-foreground/85 leading-snug line-clamp-2 w-full">
                {notification.message}
              </p>
            </Tooltip>
          )}

          {/* 底部信息 */}
          <div className="flex items-center gap-1.5 w-full min-w-0 flex-wrap pt-0.5">
            {/* 分类徽章 */}
            <div className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-tiny font-semibold bg-muted/40 text-muted-foreground/75 border border-border/10">
              <CategoryIcon className="w-2.5 h-2.5 opacity-60 shrink-0" />
              <span>{t(categoryConfig.label)}</span>
            </div>

            {sourceChipLabel && (
              <div className="inline-flex items-center max-w-[min(160px,42%)] min-w-0 px-1.5 py-0.5 rounded-md text-tiny font-medium bg-muted/25 text-muted-foreground/70 border border-border/10">
                <span className="truncate">{sourceChipLabel}</span>
              </div>
            )}

            <span className="text-tiny text-muted-foreground/45 tabular-nums shrink-0 ml-auto">
              {formatRelativeTime(notification.timestamp)}
            </span>
          </div>

          {/* 操作按钮 */}
          {notification.actions && notification.actions.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              {notification.actions.map((action, index) => (
                <Button
                  key={index}
                  variant={
                    action.variant === "danger"
                      ? "destructive"
                      : action.variant === "primary"
                        ? "default"
                        : "outline"
                  }
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    action.onClick();
                  }}
                  className="h-6 text-xs"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* 删除按钮 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(notification.id);
          }}
          className="absolute top-2 right-2 p-1 rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground/30 opacity-0 pointer-events-none group-hover/notification-card:opacity-100 group-hover/notification-card:pointer-events-auto group-focus-within/notification-card:opacity-100 group-focus-within/notification-card:pointer-events-auto transition-all"
          title={t("notifications.delete_title")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
