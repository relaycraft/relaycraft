import { describe, expect, it } from "vitest";
import type { BridgeCommandSpec } from "./contract";
import {
  getPermissionMeta,
  getPermissionUsage,
  PERMISSION_META,
  permissionKeySegment,
} from "./permissions";

function spec(partial: Partial<BridgeCommandSpec> & { command: string }): BridgeCommandSpec {
  return {
    domain: "host",
    api_surface: "test.api",
    audited: false,
    ...partial,
  };
}

describe("permissions meta", () => {
  it("should map colon ids to underscore key segments", () => {
    expect(permissionKeySegment("proxy:read")).toBe("proxy_read");
    expect(permissionKeySegment("fs:read_logs")).toBe("fs_read_logs");
  });

  it("should cover all 11 known permissions with i18n keys and risk tiers", () => {
    const known = [
      "proxy:read",
      "proxy:write",
      "fs:read_logs",
      "network:outbound",
      "ai:chat",
      "stats:read",
      "rules:write",
      "rules:read",
      "traffic:read",
      "storage:read",
      "storage:write",
    ];
    for (const permission of known) {
      const m = getPermissionMeta(permission);
      expect(m, permission).toBeDefined();
      expect(m?.labelKey).toBe(`plugins.permissions.${permissionKeySegment(permission)}.label`);
      expect(m?.descKey).toBe(`plugins.permissions.${permissionKeySegment(permission)}.desc`);
      expect(["low", "medium", "high"]).toContain(m?.risk);
    }
    expect(Object.keys(PERMISSION_META)).toHaveLength(11);
  });

  it("should return undefined for unknown permissions", () => {
    expect(getPermissionMeta("unknown:perm")).toBeUndefined();
  });
});

describe("getPermissionUsage", () => {
  const contract: BridgeCommandSpec[] = [
    spec({ command: "storage_get", permission: "storage:read", api_surface: "storage.get" }),
    spec({ command: "storage_list", permission: "storage:read", api_surface: "storage.list" }),
    spec({ command: "storage_set", permission: "storage:write", api_surface: "storage.set" }),
    spec({ command: "storage_delete", permission: "storage:write", api_surface: "storage.delete" }),
    spec({ command: "host_get_runtime", api_surface: "host.getRuntime" }),
    spec({
      command: "legacy_storage_get",
      permission: "storage:read",
      api_surface: "storage.get",
      alias_of: "storage_get",
    }),
  ];

  it("should map permissions to unlocked api surfaces", () => {
    const usage = getPermissionUsage(["storage:read", "storage:write"], contract);
    expect(usage["storage:read"]).toEqual(["storage.get", "storage.list"]);
    expect(usage["storage:write"]).toEqual(["storage.set", "storage.delete"]);
  });

  it("should not double-count surfaces exposed through alias commands", () => {
    const usage = getPermissionUsage(["storage:read"], contract);
    expect(usage["storage:read"]).toEqual(["storage.get", "storage.list"]);
  });

  it("should deduplicate repeated api surfaces", () => {
    const dup: BridgeCommandSpec[] = [
      spec({ command: "a", permission: "traffic:read", api_surface: "traffic.listFlows" }),
      spec({ command: "b", permission: "traffic:read", api_surface: "traffic.listFlows" }),
    ];
    expect(getPermissionUsage(["traffic:read"], dup)["traffic:read"]).toEqual([
      "traffic.listFlows",
    ]);
  });

  it("should tolerate unknown permissions with an empty list", () => {
    const usage = getPermissionUsage(["unknown:perm"], contract);
    expect(usage["unknown:perm"]).toEqual([]);
  });

  it("should ignore commands without a permission requirement", () => {
    const usage = getPermissionUsage(["storage:read"], contract);
    expect(usage["storage:read"]).not.toContain("host.getRuntime");
  });

  it("should handle empty permissions and empty contract", () => {
    expect(getPermissionUsage([], contract)).toEqual({});
    expect(getPermissionUsage(["storage:read"], [])).toEqual({ "storage:read": [] });
  });
});
