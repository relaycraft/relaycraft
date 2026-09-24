import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeDiagnosticPackage } from "../../lib/sharing/diagnosticPackage";
import type { Flow } from "../../types";
import { DiagnosticPackageActions } from "./DiagnosticPackageActions";

const { fetchFlowDetail, openDialog, saveDialog, readTextFile, statFile, writeTextFile, notify } =
  vi.hoisted(() => ({
    fetchFlowDetail: vi.fn(),
    openDialog: vi.fn(),
    saveDialog: vi.fn(),
    readTextFile: vi.fn(),
    statFile: vi.fn(),
    writeTextFile: vi.fn(),
    notify: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
  }));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: openDialog,
  save: saveDialog,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile,
  stat: statFile,
  writeTextFile,
}));

vi.mock("../../lib/traffic", () => ({
  fetchFlowDetail,
}));

vi.mock("../../lib/notify", () => ({ notify }));

vi.mock("../../lib/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  formatError: (e: unknown) => String(e),
}));

vi.mock("../common/Modal", () => ({
  Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("../common/Button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../common/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function httpFlow(): Flow {
  return {
    id: "flow-1",
    request: {
      method: "GET",
      url: "https://example.com/path?q=1",
      httpVersion: "HTTP/2",
      headers: [],
      cookies: [],
      queryString: [],
      bodySize: 0,
      headersSize: 0,
    },
    response: {
      status: 200,
      statusText: "OK",
      httpVersion: "HTTP/2",
      headers: [],
      cookies: [],
      content: { size: 0, mimeType: "text/plain" },
      headersSize: 0,
      bodySize: 0,
      redirectUrl: "",
    },
    _rc: { isWebsocket: false, isSse: false, websocketFrameCount: 0, hits: [] },
  } as unknown as Flow;
}

const EXPORT_BTN = "flow.diagnostic.export_btn";
const OPEN_BTN = "flow.diagnostic.open_btn";
const SAVE_BTN = "flow.diagnostic.save";

describe("DiagnosticPackageActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFlowDetail.mockResolvedValue(httpFlow());
    saveDialog.mockResolvedValue("/tmp/diag.json");
    writeTextFile.mockResolvedValue(undefined);
    openDialog.mockResolvedValue(null);
    statFile.mockResolvedValue({ size: 100 });
    readTextFile.mockResolvedValue("{}");
  });

  it("fails closed and opens no modal when the backend cannot fetch the flow", async () => {
    fetchFlowDetail.mockResolvedValue(null);
    render(<DiagnosticPackageActions flow={httpFlow()} />);

    fireEvent.click(screen.getByLabelText(EXPORT_BTN));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith("flow.diagnostic.fetch_failed", "common.error");
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("fails closed when the fetched flow is not the selected one", async () => {
    fetchFlowDetail.mockResolvedValue({ ...httpFlow(), id: "other-flow" });
    render(<DiagnosticPackageActions flow={httpFlow()} />);

    fireEvent.click(screen.getByLabelText(EXPORT_BTN));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith("flow.diagnostic.fetch_failed", "common.error");
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("rejects a freshly fetched WebSocket flow", async () => {
    const ws = httpFlow();
    ws._rc.isWebsocket = true;
    fetchFlowDetail.mockResolvedValue(ws);
    render(<DiagnosticPackageActions flow={httpFlow()} />);

    fireEvent.click(screen.getByLabelText(EXPORT_BTN));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith(
        "flow.diagnostic.errors.unsupported_flow",
        "common.error",
      );
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("hides the export button for WebSocket/SSE flows but keeps open available", () => {
    const ws = httpFlow();
    ws._rc.isWebsocket = true;
    render(<DiagnosticPackageActions flow={ws} />);
    expect(screen.queryByLabelText(EXPORT_BTN)).not.toBeInTheDocument();
    expect(screen.getByLabelText(OPEN_BTN)).toBeInTheDocument();
  });

  it("previews the exact bytes and writes them only after save confirmation", async () => {
    render(<DiagnosticPackageActions flow={httpFlow()} />);

    fireEvent.click(screen.getByLabelText(EXPORT_BTN));
    await waitFor(() => expect(screen.getByTestId("modal")).toBeInTheDocument());
    expect(fetchFlowDetail).toHaveBeenCalledWith("flow-1");

    // Edit the note — the preview must be recomputed.
    const note = screen.getByLabelText("flow.diagnostic.note_label");
    fireEvent.change(note, { target: { value: "hello note" } });

    const preview = screen.getByTestId("modal").querySelector("pre");
    const previewText = preview?.textContent ?? "";
    expect(previewText).toContain('"method": "GET"');
    expect(previewText).toContain('"note": "hello note"');
    expect(previewText).not.toContain("example.com");

    fireEvent.click(screen.getByText(SAVE_BTN));

    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith("/tmp/diag.json", previewText);
    });
    expect(notify.success).toHaveBeenCalledWith("flow.diagnostic.saved", "common.success");
    await waitFor(() => expect(screen.queryByTestId("modal")).not.toBeInTheDocument());
  });

  it("does not write when the save dialog is cancelled", async () => {
    saveDialog.mockResolvedValue(null);
    render(<DiagnosticPackageActions flow={httpFlow()} />);

    fireEvent.click(screen.getByLabelText(EXPORT_BTN));
    await waitFor(() => expect(screen.getByTestId("modal")).toBeInTheDocument());

    fireEvent.click(screen.getByText(SAVE_BTN));

    await waitFor(() => expect(saveDialog).toHaveBeenCalled());
    expect(writeTextFile).not.toHaveBeenCalled();
    // Modal stays open after a cancelled save.
    expect(screen.getByTestId("modal")).toBeInTheDocument();
  });

  it("opens a package file read-only and shows the rendered JSON", async () => {
    const fileJson = serializeDiagnosticPackage({
      kind: "relaycraft-diagnostic",
      version: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      entries: [{ method: "POST", status: 404, scheme: "http" }],
      note: "from file",
    });
    openDialog.mockResolvedValue("/tmp/in.json");
    readTextFile.mockResolvedValue(fileJson);

    render(<DiagnosticPackageActions flow={httpFlow()} />);
    fireEvent.click(screen.getByLabelText(OPEN_BTN));

    await waitFor(() => expect(screen.getByTestId("modal")).toBeInTheDocument());
    expect(readTextFile).toHaveBeenCalledWith("/tmp/in.json");
    const preview = screen.getByTestId("modal").querySelector("pre");
    expect(preview?.textContent).toContain('"method": "POST"');
    expect(preview?.textContent).toContain('"note": "from file"');
    // No save affordance in the read-only view.
    expect(screen.queryByText(SAVE_BTN)).not.toBeInTheDocument();
  });

  it("rejects an oversized file by stat without reading it", async () => {
    openDialog.mockResolvedValue("/tmp/huge.json");
    statFile.mockResolvedValue({ size: 1024 * 1024 });

    render(<DiagnosticPackageActions flow={httpFlow()} />);
    fireEvent.click(screen.getByLabelText(OPEN_BTN));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith(
        "flow.diagnostic.errors.file_too_large",
        "common.error",
      );
    });
    expect(readTextFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("rejects an invalid package file on open", async () => {
    openDialog.mockResolvedValue("/tmp/bad.json");
    readTextFile.mockResolvedValue(JSON.stringify({ kind: "wrong", version: 1 }));

    render(<DiagnosticPackageActions flow={httpFlow()} />);
    fireEvent.click(screen.getByLabelText(OPEN_BTN));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith(
        "flow.diagnostic.errors.invalid_package",
        "common.error",
      );
    });
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("does nothing when the open dialog is cancelled", async () => {
    openDialog.mockResolvedValue(null);
    render(<DiagnosticPackageActions flow={httpFlow()} />);
    fireEvent.click(screen.getByLabelText(OPEN_BTN));

    await waitFor(() => expect(openDialog).toHaveBeenCalled());
    expect(readTextFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});
