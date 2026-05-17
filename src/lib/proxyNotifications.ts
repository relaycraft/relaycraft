import i18n from "../i18n";
import type { NotificationPriority, NotificationType } from "../stores/notificationStore";

type ProxyEvent =
  | "start_success"
  | "start_fail"
  | "stop_success"
  | "stop_fail"
  | "restart_success"
  | "restart_fail";

interface ProxyNotificationOptions {
  port?: number;
  scriptCount?: number;
  error?: string;
}

const PROXY_EVENT_META: Record<
  ProxyEvent,
  { type: NotificationType; priority: NotificationPriority }
> = {
  start_success: { type: "success", priority: "normal" },
  start_fail: { type: "error", priority: "critical" },
  stop_success: { type: "info", priority: "normal" },
  stop_fail: { type: "error", priority: "high" },
  restart_success: { type: "success", priority: "normal" },
  restart_fail: { type: "error", priority: "critical" },
};

function buildProxyMessage(event: ProxyEvent, options: ProxyNotificationOptions): string {
  if (event === "start_success") {
    return `${i18n.t("proxy_store.start_success_msg", { port: options.port })}${
      options.scriptCount && options.scriptCount > 0
        ? i18n.t("proxy_store.scripts_loaded", { count: options.scriptCount })
        : ""
    }`;
  }
  if (event === "restart_success") {
    return `${i18n.t("proxy_store.restart_success_msg", { port: options.port })}${
      options.scriptCount && options.scriptCount > 0
        ? i18n.t("proxy_store.scripts_loaded", { count: options.scriptCount })
        : ""
    }`;
  }
  if (event === "start_fail") {
    return i18n.t("proxy_store.start_fail_msg", { error: options.error });
  }
  if (event === "stop_fail") {
    return i18n.t("proxy_store.stop_fail_msg", { error: options.error });
  }
  if (event === "restart_fail") {
    return i18n.t("proxy_store.restart_fail_msg", { error: options.error });
  }
  return i18n.t("proxy_store.stop_success_msg");
}

export async function notifyProxyEvent(
  event: ProxyEvent,
  options: ProxyNotificationOptions = {},
): Promise<void> {
  const { useNotificationStore } = await import("../stores/notificationStore");
  const meta = PROXY_EVENT_META[event];
  useNotificationStore.getState().addNotification({
    title: i18n.t(`proxy_store.${event}_title`),
    message: buildProxyMessage(event, options),
    type: meta.type,
    category: "system",
    priority: meta.priority,
    source: "Proxy Engine",
  });
}
