import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditLogEntry } from "../../../types/audit";
import { AuditLogSection } from "./AuditLogSection";

const { invokeMock, pluginState, pluginStoreMock } = vi.hoisted(() => {
  const pluginState = {
    plugins: [{ manifest: { id: "p1", name: "Resolved Plugin" }, enabled: true }] as any[],
  };
  const pluginStoreMock = (selector?: (state: any) => any) =>
    selector ? selector(pluginState) : pluginState;
  return { invokeMock: vi.fn(), pluginState, pluginStoreMock };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../../stores/pluginStore", () => ({
  usePluginStore: pluginStoreMock,
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  },
}));

const mockEvents: AuditLogEntry[] = [
  {
    ts: "2025-01-02T03:04:05+08:00",
    actor: "user",
    action: "config.update",
    target: "proxy_port",
    result: "ok",
    detail: "proxy_port: 9090",
    legacy: false,
  },
  {
    ts: "2025-01-02T03:04:06+08:00",
    actor: "plugin",
    actorId: "p1",
    actorName: "Stale Name",
    action: "plugin.call",
    target: "http_send",
    result: "denied",
    detail: "POST https://api.example.com/x",
    legacy: false,
  },
  {
    ts: "2025-01-02 03:04:07",
    legacy: true,
    raw: "[2025-01-02 03:04:07] [AUDIT] Updated Configuration: old",
  },
];

describe("AuditLogSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginState.plugins = [{ manifest: { id: "p1", name: "Resolved Plugin" }, enabled: true }];
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_audit_events") return Promise.resolve(mockEvents);
      return Promise.resolve(null);
    });
  });

  it("renders structured events, resolves plugin names and shows legacy rows", async () => {
    render(<AuditLogSection />);

    await waitFor(() => {
      expect(screen.getByText("privacy.audit.actions.config.update")).toBeInTheDocument();
    });
    // Plugin actorId resolves to the manifest name (not actorName fallback).
    expect(screen.getByText(/Resolved Plugin/)).toBeInTheDocument();
    // Targets render in mono, results get badges.
    expect(screen.getByText("proxy_port")).toBeInTheDocument();
    expect(screen.getByText("privacy.audit.result.denied")).toBeInTheDocument();
    // Legacy row shows raw text + badge.
    expect(screen.getByText("privacy.audit.legacy_badge")).toBeInTheDocument();
    expect(screen.getByText(/Updated Configuration: old/)).toBeInTheDocument();
  });

  it("expands a row to reveal detail on click", async () => {
    render(<AuditLogSection />);

    await waitFor(() => {
      expect(screen.getByText("privacy.audit.actions.config.update")).toBeInTheDocument();
    });
    expect(screen.queryByText("proxy_port: 9090")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("privacy.audit.actions.config.update"));

    await waitFor(() => {
      expect(screen.getByText("proxy_port: 9090")).toBeInTheDocument();
    });
  });

  it("calls get_audit_events with the actor filter when a chip is clicked", async () => {
    render(<AuditLogSection />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_audit_events", {
        limit: 200,
        actor: undefined,
        query: undefined,
      });
    });

    fireEvent.click(screen.getByText("privacy.audit.filter.plugin"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_audit_events", {
        limit: 200,
        actor: "plugin",
        query: undefined,
      });
    });
  });

  it("shows the empty state when no events match", async () => {
    invokeMock.mockImplementation((command: string) =>
      command === "get_audit_events" ? Promise.resolve([]) : Promise.resolve(null),
    );
    render(<AuditLogSection />);

    await waitFor(() => {
      expect(screen.getByText("privacy.audit.empty")).toBeInTheDocument();
    });
  });
});
