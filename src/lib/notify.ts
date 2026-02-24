import { toast } from "sonner";
import i18n from "../i18n";
import {
  type NotificationCategory,
  type NotificationPriority,
  useNotificationStore,
} from "../stores/notificationStore";

type NotificationType = "success" | "error" | "info" | "warning";

export interface NotifyOptions {
  title?: string;
  toastOnly?: boolean;
}

export const notify = {
  success: (message: string, options?: string | NotifyOptions) => {
    trigger("success", message, options);
  },
  error: (message: string, options?: string | NotifyOptions) => {
    trigger("error", message, options);
  },
  info: (message: string, options?: string | NotifyOptions) => {
    trigger("info", message, options);
  },
  warning: (message: string, options?: string | NotifyOptions) => {
    trigger("warning", message, options);
  },
};

const inferCategoryAndPriority = (
  type: NotificationType,
  message: string,
): { category: NotificationCategory; priority: NotificationPriority } => {
  // 根据消息内容推断分类
  const lowerMessage = message.toLowerCase();

  let category: NotificationCategory = "system";
  let priority: NotificationPriority = "normal";

  // 推断分类
  if (lowerMessage.includes("plugin") || lowerMessage.includes("插件")) {
    category = "plugin";
  } else if (lowerMessage.includes("script") || lowerMessage.includes("脚本")) {
    category = "script";
  } else if (
    lowerMessage.includes("network") ||
    lowerMessage.includes("网络") ||
    lowerMessage.includes("request") ||
    lowerMessage.includes("请求")
  ) {
    category = "network";
  } else if (
    lowerMessage.includes("update") ||
    lowerMessage.includes("更新") ||
    lowerMessage.includes("version") ||
    lowerMessage.includes("版本")
  ) {
    category = "update";
  } else if (
    lowerMessage.includes("certificate") ||
    lowerMessage.includes("证书") ||
    lowerMessage.includes("security") ||
    lowerMessage.includes("安全")
  ) {
    category = "security";
  }

  // 推断优先级
  if (type === "error") {
    priority =
      lowerMessage.includes("crash") ||
      lowerMessage.includes("崩溃") ||
      lowerMessage.includes("critical")
        ? "critical"
        : "high";
  } else if (type === "warning") {
    priority = "high";
  } else if (type === "success") {
    priority = "normal";
  } else {
    priority = "low";
  }

  return { category, priority };
};

const trigger = (type: NotificationType, message: string, options?: string | NotifyOptions) => {
  const { dnd, addNotification } = useNotificationStore.getState();

  // Parse options
  const title = typeof options === "string" ? options : options?.title;
  const toastOnly = typeof options === "object" ? options?.toastOnly : false;

  const { category, priority } = inferCategoryAndPriority(type, message);

  // Add to history if not toastOnly
  if (!toastOnly) {
    addNotification({
      title:
        title ||
        i18n.t(`common.${type}`, {
          defaultValue: type.charAt(0).toUpperCase() + type.slice(1),
        }),
      message,
      type,
      category,
      priority,
      source: "System",
    });
  }

  // Show toast if not DND
  if (!dnd) {
    switch (type) {
      case "success":
        toast.success(message);
        break;
      case "error":
        toast.error(message);
        break;
      case "warning":
        toast.warning(message);
        break;
      case "info":
        toast.info(message);
        break;
    }
  }
};
