import { describe, expect, it } from "vitest";
import type { Flow } from "../../types";
import {
  buildDiagnosticPackage,
  DIAGNOSTIC_NOTE_MAX_LENGTH,
  DIAGNOSTIC_PACKAGE_MAX_BYTES,
  type DiagnosticPackage,
  DiagnosticPackageError,
  parseDiagnosticPackage,
  serializeDiagnosticPackage,
} from "./diagnosticPackage";

function secretFlow(): Flow {
  return {
    id: "SECRET-FLOW-ID",
    seq: 42,
    startedDateTime: "SECRET-TIMESTAMP",
    time: 123,
    request: {
      method: "post",
      url: "https://SECRET-HOST.example/SECRET_PATH?token=SECRET_QUERY",
      httpVersion: "HTTP/2",
      headers: [{ name: "authorization", value: "Bearer SECRET_HEADER" }],
      cookies: [{ name: "session", value: "SECRET_COOKIE" }],
      queryString: [{ name: "token", value: "SECRET_QUERY" }],
      postData: { mimeType: "text/plain", text: "SECRET_BODY" },
      bodySize: 11,
      headersSize: 100,
    },
    response: {
      status: 201,
      statusText: "SECRET_STATUS_TEXT",
      httpVersion: "HTTP/2",
      headers: [{ name: "set-cookie", value: "SECRET_RESP_HEADER" }],
      cookies: [{ name: "s", value: "SECRET_RESP_COOKIE" }],
      content: { size: 9, mimeType: "text/plain", text: "SECRET_RESP_BODY" },
      headersSize: 10,
      bodySize: 9,
      redirectUrl: "SECRET_REDIRECT",
    },
    timings: { wait: 1 },
    cache: {},
    _rc: {
      isWebsocket: false,
      isSse: false,
      websocketFrameCount: 0,
      hits: [{ id: "SECRET_RULE_ID", name: "SECRET_RULE_NAME", type: "rule" }],
      intercept: { intercepted: false },
      bodyTruncated: false,
      clientIp: "SECRET_IP",
    },
  } as unknown as Flow;
}

const SECRET_MARKERS = [
  "SECRET-FLOW-ID",
  "SECRET-TIMESTAMP",
  "SECRET-HOST",
  "SECRET_PATH",
  "SECRET_QUERY",
  "SECRET_HEADER",
  "SECRET_RESP_HEADER",
  "SECRET_COOKIE",
  "SECRET_RESP_COOKIE",
  "SECRET_BODY",
  "SECRET_RESP_BODY",
  "SECRET_REDIRECT",
  "SECRET_RULE_ID",
  "SECRET_RULE_NAME",
  "SECRET_IP",
  "SECRET_STATUS_TEXT",
];

function flowWith(overrides: {
  method?: string;
  url?: string;
  status?: number;
  isWebsocket?: boolean;
  isSse?: boolean;
}): Flow {
  const flow = secretFlow();
  if (overrides.method !== undefined) flow.request.method = overrides.method;
  if (overrides.url !== undefined) flow.request.url = overrides.url;
  if (overrides.status !== undefined) flow.response.status = overrides.status;
  if (overrides.isWebsocket !== undefined) flow._rc.isWebsocket = overrides.isWebsocket;
  if (overrides.isSse !== undefined) flow._rc.isSse = overrides.isSse;
  return flow;
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DiagnosticPackageError);
    expect((e as DiagnosticPackageError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DiagnosticPackageError(${code})`);
}

describe("buildDiagnosticPackage", () => {
  it("contains only the whitelisted metadata fields — no secret markers", () => {
    const pkg = buildDiagnosticPackage(secretFlow(), "note text");
    const json = serializeDiagnosticPackage(pkg);

    for (const marker of SECRET_MARKERS) {
      expect(json).not.toContain(marker);
    }
    expect(json).not.toContain("_rc");
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("postData");
    expect(json).not.toContain("hits");
    expect(json).not.toContain("cookie");
    expect(json).not.toContain("Cookie");

    expect(Object.keys(pkg).sort()).toEqual(
      ["createdAt", "entries", "kind", "note", "version"].sort(),
    );
    expect(pkg).toMatchObject({
      kind: "relaycraft-diagnostic",
      version: 1,
      note: "note text",
      entries: [{ method: "POST", status: 201, scheme: "https" }],
    });
    expect(Object.keys(pkg.entries[0]).sort()).toEqual(["method", "scheme", "status"].sort());
  });

  it("normalizes method to the allowlist or OTHER", () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(buildDiagnosticPackage(flowWith({ method: m }), "").entries[0].method).toBe(m);
    }
    expect(buildDiagnosticPackage(flowWith({ method: "get" }), "").entries[0].method).toBe("GET");
    for (const m of ["CONNECT", "TRACE", "PROPFIND", "", "get x"]) {
      expect(buildDiagnosticPackage(flowWith({ method: m }), "").entries[0].method).toBe("OTHER");
    }
  });

  it("keeps integer status in 100..599, otherwise null", () => {
    expect(buildDiagnosticPackage(flowWith({ status: 200 }), "").entries[0].status).toBe(200);
    for (const s of [0, 99, 600, 200.5, -1] as number[]) {
      expect(buildDiagnosticPackage(flowWith({ status: s }), "").entries[0].status).toBeNull();
    }
    const flow = secretFlow();
    // @ts-expect-error deliberately wrong type from a loose backend payload
    flow.response.status = "200";
    expect(buildDiagnosticPackage(flow, "").entries[0].status).toBeNull();
  });

  it("derives scheme from request.url, defaulting to other", () => {
    expect(buildDiagnosticPackage(flowWith({ url: "http://a.b/x" }), "").entries[0].scheme).toBe(
      "http",
    );
    expect(buildDiagnosticPackage(flowWith({ url: "HTTPS://a.b/x" }), "").entries[0].scheme).toBe(
      "https",
    );
    for (const url of ["ws://a.b", "wss://a.b", "ftp://a.b", "not a url", ""]) {
      expect(buildDiagnosticPackage(flowWith({ url }), "").entries[0].scheme).toBe("other");
    }
  });

  it("rejects WebSocket and SSE flows", () => {
    expectCode(
      () => buildDiagnosticPackage(flowWith({ isWebsocket: true }), ""),
      "unsupported_flow",
    );
    expectCode(() => buildDiagnosticPackage(flowWith({ isSse: true }), ""), "unsupported_flow");
  });

  it("rejects an absent flow", () => {
    expectCode(() => buildDiagnosticPackage(null, ""), "no_flow");
    expectCode(() => buildDiagnosticPackage(undefined, ""), "no_flow");
  });

  it("enforces the note length limit", () => {
    const ok = buildDiagnosticPackage(secretFlow(), "x".repeat(DIAGNOSTIC_NOTE_MAX_LENGTH));
    expect(ok.note.length).toBe(DIAGNOSTIC_NOTE_MAX_LENGTH);
    expectCode(
      () => buildDiagnosticPackage(secretFlow(), "x".repeat(DIAGNOSTIC_NOTE_MAX_LENGTH + 1)),
      "note_too_long",
    );
  });

  it("serializes to the exact bytes JSON.stringify produces", () => {
    const pkg: DiagnosticPackage = {
      kind: "relaycraft-diagnostic",
      version: 1,
      createdAt: "2024-01-01T00:00:00.000Z",
      entries: [{ method: "GET", status: 200, scheme: "https" }],
      note: "hello",
    };
    expect(serializeDiagnosticPackage(pkg)).toBe(JSON.stringify(pkg, null, 2));
    expect(serializeDiagnosticPackage(pkg)).toBe(
      [
        "{",
        '  "kind": "relaycraft-diagnostic",',
        '  "version": 1,',
        '  "createdAt": "2024-01-01T00:00:00.000Z",',
        '  "entries": [',
        "    {",
        '      "method": "GET",',
        '      "status": 200,',
        '      "scheme": "https"',
        "    }",
        "  ],",
        '  "note": "hello"',
        "}",
      ].join("\n"),
    );
  });
});

describe("parseDiagnosticPackage", () => {
  const valid: DiagnosticPackage = {
    kind: "relaycraft-diagnostic",
    version: 1,
    createdAt: "2024-01-01T00:00:00.000Z",
    entries: [{ method: "GET", status: 200, scheme: "https" }],
    note: "hi",
  };

  it("round-trips a serialized package", () => {
    expect(parseDiagnosticPackage(serializeDiagnosticPackage(valid))).toEqual(valid);
    const withNull = { ...valid, entries: [{ method: "OTHER", status: null, scheme: "other" }] };
    expect(
      parseDiagnosticPackage(serializeDiagnosticPackage(withNull as DiagnosticPackage)),
    ).toEqual(withNull);
  });

  it("rejects files larger than the limit before parsing", () => {
    const big = `${serializeDiagnosticPackage(valid)}${" ".repeat(DIAGNOSTIC_PACKAGE_MAX_BYTES)}`;
    expectCode(() => parseDiagnosticPackage(big), "file_too_large");
  });

  it("rejects invalid JSON and non-object roots", () => {
    expectCode(() => parseDiagnosticPackage("not json"), "invalid_json");
    expectCode(() => parseDiagnosticPackage("[1,2]"), "invalid_package");
    expectCode(() => parseDiagnosticPackage("42"), "invalid_package");
    expectCode(() => parseDiagnosticPackage(""), "invalid_json");
  });

  it("rejects wrong kind, wrong version and unknown fields", () => {
    expectCode(
      () => parseDiagnosticPackage(JSON.stringify({ ...valid, kind: "other" })),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(JSON.stringify({ ...valid, version: 2 })),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(JSON.stringify({ ...valid, url: "https://x" })),
      "invalid_package",
    );
    expectCode(
      () =>
        parseDiagnosticPackage(
          JSON.stringify({
            ...valid,
            entries: [{ method: "GET", status: 200, scheme: "https", host: "x" }],
          }),
        ),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(JSON.stringify({ ...valid, _rc: {} })),
      "invalid_package",
    );
  });

  it("rejects malformed field types", () => {
    const bad = (mutate: (o: any) => void) => {
      const o = JSON.parse(JSON.stringify(valid));
      mutate(o);
      return JSON.stringify(o);
    };
    expectCode(() => parseDiagnosticPackage(bad((o) => (o.note = 3))), "invalid_package");
    expectCode(
      () =>
        parseDiagnosticPackage(bad((o) => (o.note = "x".repeat(DIAGNOSTIC_NOTE_MAX_LENGTH + 1)))),
      "invalid_package",
    );
    expectCode(() => parseDiagnosticPackage(bad((o) => (o.entries = {}))), "invalid_package");
    expectCode(() => parseDiagnosticPackage(bad((o) => (o.entries = [5]))), "invalid_package");
    expectCode(() => parseDiagnosticPackage(bad((o) => (o.entries = []))), "invalid_package");
    expectCode(
      () =>
        parseDiagnosticPackage(
          bad((o) => o.entries.push({ method: "POST", status: 200, scheme: "http" })),
        ),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].method = 5))),
      "invalid_package",
    );
    // A method outside the emitted allowlist — even a plausible-looking
    // string that could smuggle a secret — is rejected.
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].method = "SECRET_METHOD_MARKER"))),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].method = "get"))),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].status = 99))),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].status = 600))),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].status = "200"))),
      "invalid_package",
    );
    expectCode(
      () => parseDiagnosticPackage(bad((o) => (o.entries[0].scheme = "ftp"))),
      "invalid_package",
    );
    expectCode(() => parseDiagnosticPackage(bad((o) => (o.createdAt = 123))), "invalid_package");
  });

  it("rejects non-canonical or invalid createdAt timestamps", () => {
    const bad = (value: unknown) => {
      const o = JSON.parse(JSON.stringify(valid));
      o.createdAt = value;
      return JSON.stringify(o);
    };
    expectCode(() => parseDiagnosticPackage(bad("not a date")), "invalid_package");
    // Parses as a date but is not the canonical UTC ISO form we emit.
    expectCode(() => parseDiagnosticPackage(bad("2024-01-01")), "invalid_package");
    expectCode(() => parseDiagnosticPackage(bad("2024-01-01T00:00:00Z")), "invalid_package");
    // Canonical form is accepted.
    expect(parseDiagnosticPackage(bad("2024-01-01T00:00:00.000Z")).createdAt).toBe(
      "2024-01-01T00:00:00.000Z",
    );
  });
});
