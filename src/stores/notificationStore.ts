import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type NotificationType = "info" | "success" | "warning" | "error";

export type NotificationCategory =
  | "system" // 系统通知(代理启动/停止、证书更新等)
  | "plugin" // 插件通知(插件激活、错误等)
  | "script" // 脚本通知(脚本执行、错误等)
  | "network" // 网络通知(请求拦截、重放等)
  | "update" // 更新通知(版本更新、功能提示等)
  | "security"; // 安全通知(证书问题、权限问题等)

export type NotificationPriority =
  | "critical" // 🔴 严重 - 需要立即处理
  | "high" // 🟠 高 - 需要关注
  | "normal" // 🟢 正常 - 一般信息
  | "low"; // 🔵 低 - 提示信息

export interface NotificationAction {
  label: string;
  variant?: "primary" | "secondary" | "danger";
  onClick: () => void | Promise<void>;
}

export interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  type: NotificationType;
  category: NotificationCategory;
  priority: NotificationPriority;
  timestamp: number;
  read: boolean;
  source?: string;

  // 操作按钮
  actions?: NotificationAction[];

  // 元数据(用于快捷操作)
  metadata?: {
    pluginId?: string;
    scriptName?: string;
    ruleId?: string;
    [key: string]: any;
  };
}

interface NotificationStore {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  notifications: NotificationItem[];
  addNotification: (notification: Omit<NotificationItem, "id" | "timestamp" | "read">) => void;
  removeNotification: (id: string) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  unreadCount: () => number;
  dnd: boolean;
  toggleDnd: () => void;

  // 筛选功能
  filterCategory: NotificationCategory | "all";
  filterPriority: NotificationPriority | "all";
  filterRead: "all" | "unread" | "read";
  searchQuery: string;
  setFilterCategory: (category: NotificationCategory | "all") => void;
  setFilterPriority: (priority: NotificationPriority | "all") => void;
  setFilterRead: (read: "all" | "unread" | "read") => void;
  setSearchQuery: (query: string) => void;
  getFilteredNotifications: () => NotificationItem[];
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set, get) => ({
      isOpen: false,
      dnd: false,
      setIsOpen: (open) => set({ isOpen: open }),
      notifications: [],

      // 筛选状态
      filterCategory: "all",
      filterPriority: "all",
      filterRead: "all",
      searchQuery: "",

      addNotification: (item) => {
        const newItem: NotificationItem = {
          ...item,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          read: false,
          // 提供默认值以保持向后兼容
          category: item.category ?? "system",
          priority: item.priority ?? "normal",
        };
        set((state) => ({
          notifications: [newItem, ...state.notifications].slice(0, 100),
        }));
      },
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
      markAsRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),
      markAllAsRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),
      clearAll: () => set({ notifications: [] }),
      unreadCount: () => {
        const state = get();
        return state.notifications.filter((n) => !n.read).length;
      },
      toggleDnd: () => set((state) => ({ dnd: !state.dnd })),

      // 筛选方法
      setFilterCategory: (category) => set({ filterCategory: category }),
      setFilterPriority: (priority) => set({ filterPriority: priority }),
      setFilterRead: (read) => set({ filterRead: read }),
      setSearchQuery: (query) => set({ searchQuery: query }),

      getFilteredNotifications: () => {
        const state = get();
        let filtered = state.notifications;

        // 按分类筛选
        if (state.filterCategory !== "all") {
          filtered = filtered.filter((n) => n.category === state.filterCategory);
        }

        // 按优先级筛选
        if (state.filterPriority !== "all") {
          filtered = filtered.filter((n) => n.priority === state.filterPriority);
        }

        // 按已读状态筛选
        if (state.filterRead === "unread") {
          filtered = filtered.filter((n) => !n.read);
        } else if (state.filterRead === "read") {
          filtered = filtered.filter((n) => n.read);
        }

        // 按搜索查询筛选
        if (state.searchQuery) {
          const query = state.searchQuery.toLowerCase();
          filtered = filtered.filter(
            (n) =>
              n.title.toLowerCase().includes(query) ||
              n.message?.toLowerCase().includes(query) ||
              n.source?.toLowerCase().includes(query),
          );
        }

        return filtered;
      },
    }),
    {
      name: "relaycraft-notifications",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        notifications: state.notifications.map((n) => {
          // Exclude actions as they may contain functions which cannot be persisted
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { actions, ...rest } = n;
          return rest;
        }),
        dnd: state.dnd,
      }),
      onRehydrateStorage: () => (state) => {
        // 数据迁移:为旧通知添加默认字段
        if (state?.notifications) {
          state.notifications = state.notifications.map((notification) => ({
            ...notification,
            category: notification.category ?? "system",
            priority: notification.priority ?? "normal",
          }));
        }
      },
    },
  ),
);
