import { describe, expect, it } from "vitest";
import { formatAuditLine } from "./auditLog";

describe("formatAuditLine", () => {
  it("formats a full JSON event", () => {
    const line = JSON.stringify({
      v: 1,
      ts: "2025-01-02T03:04:05+08:00",
      actor: "plugin",
      actorId: "p1",
      actorName: "My Plugin",
      action: "plugin.call",
      target: "http_send",
      result: "denied",
      detail: "POST https://api.example.com/x",
    });
    expect(formatAuditLine(line)).toBe(
      "[2025-01-02T03:04:05+08:00] plugin(My Plugin) plugin.call http_send · denied · POST https://api.example.com/x",
    );
  });

  it("falls back to actorId when actorName is absent", () => {
    const line = JSON.stringify({
      ts: "2025-01-02T03:04:05+08:00",
      actor: "mcp",
      actorId: "claude-desktop",
      action: "mcp.create_rule",
      result: "ok",
    });
    expect(formatAuditLine(line)).toBe(
      "[2025-01-02T03:04:05+08:00] mcp(claude-desktop) mcp.create_rule · ok",
    );
  });

  it("omits the parenthesised label for bare actors", () => {
    const line = JSON.stringify({
      ts: "2025-01-02T03:04:05+08:00",
      actor: "user",
      action: "config.update",
      result: "ok",
      detail: "proxy_port",
    });
    expect(formatAuditLine(line)).toBe(
      "[2025-01-02T03:04:05+08:00] user config.update · ok · proxy_port",
    );
  });

  it("returns legacy text lines unchanged", () => {
    const legacy = "[2025-01-02 03:04:05] [AUDIT] Updated Configuration: proxy_port";
    expect(formatAuditLine(legacy)).toBe(legacy);
  });

  it("returns malformed JSON unchanged", () => {
    const bad = "{not valid json";
    expect(formatAuditLine(bad)).toBe(bad);
  });

  it("returns non-object JSON unchanged", () => {
    expect(formatAuditLine("[1,2,3]")).toBe("[1,2,3]");
    expect(formatAuditLine('"just a string"')).toBe('"just a string"');
  });
});
