import { beforeEach, describe, expect, it } from "vitest";
import { type NotificationItem, useNotificationStore } from "./notificationStore";

describe("notificationStore", () => {
  beforeEach(() => {
    // Reset store before each test
    useNotificationStore.setState({
      notifications: [],
      isOpen: false,
      dnd: false,
      filterCategory: "all",
      filterPriority: "all",
      filterRead: "all",
      searchQuery: "",
    });
  });

  it("should add a notification", () => {
    const store = useNotificationStore.getState();
    store.addNotification({
      title: "Test Notification",
      type: "info",
      category: "system",
      priority: "normal",
    });

    const state = useNotificationStore.getState();
    expect(state.notifications.length).toBe(1);
    expect(state.notifications[0].title).toBe("Test Notification");
    expect(state.notifications[0].read).toBe(false);
    expect(state.notifications[0].id).toBeDefined();
    expect(state.notifications[0].timestamp).toBeDefined();
  });

  it("should provide default category and priority if not specified", () => {
    const store = useNotificationStore.getState();
    // Use type assertion here since category and priority are technically required by Omit but might be omitted in reality if using Partial or older versions.
    store.addNotification({
      title: "Test Default",
      type: "success",
    } as Omit<NotificationItem, "id" | "timestamp" | "read">);

    const state = useNotificationStore.getState();
    expect(state.notifications[0].category).toBe("system");
    expect(state.notifications[0].priority).toBe("normal");
  });

  it("should keep a max of 100 notifications", () => {
    const store = useNotificationStore.getState();
    for (let i = 0; i < 110; i++) {
      store.addNotification({
        title: `Test ${i}`,
        type: "info",
        category: "system",
        priority: "normal",
      });
    }

    const state = useNotificationStore.getState();
    expect(state.notifications.length).toBe(100);
    // The most recently added ones should be first
    expect(state.notifications[0].title).toBe("Test 109");
  });

  it("should remove a notification by id", () => {
    const store = useNotificationStore.getState();
    store.addNotification({
      title: "To Remove",
      type: "info",
      category: "system",
      priority: "normal",
    });

    let state = useNotificationStore.getState();
    const id = state.notifications[0].id;

    state.removeNotification(id);
    state = useNotificationStore.getState();
    expect(state.notifications.length).toBe(0);
  });

  it("should mark a notification as read", () => {
    const store = useNotificationStore.getState();
    store.addNotification({
      title: "To Read",
      type: "info",
      category: "system",
      priority: "normal",
    });

    let state = useNotificationStore.getState();
    const id = state.notifications[0].id;

    state.markAsRead(id);
    state = useNotificationStore.getState();
    expect(state.notifications[0].read).toBe(true);
    expect(state.unreadCount()).toBe(0);
  });

  it("should mark all as read", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ title: "1", type: "info", category: "system", priority: "normal" });
    store.addNotification({ title: "2", type: "info", category: "system", priority: "normal" });

    let state = useNotificationStore.getState();
    expect(state.unreadCount()).toBe(2);

    state.markAllAsRead();
    state = useNotificationStore.getState();
    expect(state.unreadCount()).toBe(0);
    expect(state.notifications[0].read).toBe(true);
    expect(state.notifications[1].read).toBe(true);
  });

  it("should clear all notifications", () => {
    const store = useNotificationStore.getState();
    store.addNotification({ title: "1", type: "info", category: "system", priority: "normal" });
    store.addNotification({ title: "2", type: "info", category: "system", priority: "normal" });

    let state = useNotificationStore.getState();
    expect(state.notifications.length).toBe(2);

    state.clearAll();
    state = useNotificationStore.getState();
    expect(state.notifications.length).toBe(0);
  });

  it("should filter notifications correctly", () => {
    const store = useNotificationStore.getState();
    store.addNotification({
      title: "Sys critical",
      type: "error",
      category: "system",
      priority: "critical",
    });
    store.addNotification({
      title: "Plugin normal",
      type: "info",
      category: "plugin",
      priority: "normal",
    });
    store.addNotification({ title: "Sys low", type: "info", category: "system", priority: "low" });

    let state = useNotificationStore.getState();
    // find index of "Sys critical"
    const sysCriticalItem = state.notifications.find((n) => n.title === "Sys critical");
    if (sysCriticalItem) {
      state.markAsRead(sysCriticalItem.id);
    }

    // Refresh state after markAsRead
    state = useNotificationStore.getState();

    // Test category filter
    state.setFilterCategory("system");
    let filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(2);

    state.setFilterCategory("plugin");
    filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(1);

    // Reset category, test priority
    state.setFilterCategory("all");
    state.setFilterPriority("critical");
    filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe("Sys critical");

    // Reset priority, test read status
    state.setFilterPriority("all");
    state.setFilterRead("read");
    filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe("Sys critical");

    state.setFilterRead("unread");
    filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(2);

    // Test search
    state.setFilterRead("all");
    state.setSearchQuery("plugin");
    filtered = state.getFilteredNotifications();
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe("Plugin normal");
  });
});
