import { describe, expect, it } from "vitest";
import {
  BODY_TRUNCATE_LIMIT,
  SENSITIVE_HEADERS,
  SENSITIVE_QUERY_PARAMS,
  sanitizeHeaders,
  sanitizeUrl,
  truncate,
  URL_TRUNCATE_LIMIT,
} from "./utils";

describe("sanitizeHeaders", () => {
  it("redacts every sensitive header case-insensitively", () => {
    for (const name of SENSITIVE_HEADERS) {
      const upper = name.toUpperCase();
      const mixed = name.replace(/(^|-)(.)/g, (_m, sep, ch) => sep + ch.toUpperCase());
      for (const variant of [name, upper, mixed]) {
        const result = sanitizeHeaders({ [variant]: "secret-value" });
        expect(result[variant]).toBe("[SENSITIVE_REDACTED]");
      }
    }
  });

  it("truncates non-sensitive header values", () => {
    const result = sanitizeHeaders({ "x-custom": "v".repeat(200) });
    expect(result["x-custom"]).toContain("[TRUNCATED");
  });
});

describe("sanitizeUrl", () => {
  it("leaves URLs without query strings unchanged", () => {
    expect(sanitizeUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(sanitizeUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(sanitizeUrl("/relative/path")).toBe("/relative/path");
  });

  it("redacts every sensitive query param value", () => {
    for (const param of SENSITIVE_QUERY_PARAMS) {
      const url = `https://example.com/api?${param}=secret-value&keep=1`;
      expect(sanitizeUrl(url)).toBe(`https://example.com/api?${param}=[REDACTED]&keep=1`);
    }
  });

  it("matches param names case-insensitively", () => {
    expect(sanitizeUrl("https://example.com/?TOKEN=abc&Key=xyz")).toBe(
      "https://example.com/?TOKEN=[REDACTED]&Key=[REDACTED]",
    );
  });

  it("redacts duplicate occurrences of the same param", () => {
    expect(sanitizeUrl("https://example.com/?token=a&token=b&ok=1")).toBe(
      "https://example.com/?token=[REDACTED]&token=[REDACTED]&ok=1",
    );
  });

  it("handles encoded param names and values", () => {
    expect(sanitizeUrl("https://example.com/?api%5Fkey=encoded%20value")).toBe(
      "https://example.com/?api%5Fkey=[REDACTED]",
    );
    expect(sanitizeUrl("https://example.com/?token=a%20b%26c")).toBe(
      "https://example.com/?token=[REDACTED]",
    );
  });

  it("does not redact non-sensitive params", () => {
    expect(sanitizeUrl("https://example.com/?q=hello&page=2")).toBe(
      "https://example.com/?q=hello&page=2",
    );
  });

  it("preserves fragment after the query", () => {
    expect(sanitizeUrl("https://example.com/?token=abc#section")).toBe(
      "https://example.com/?token=[REDACTED]#section",
    );
  });

  it("does not throw on malformed or relative URLs", () => {
    expect(sanitizeUrl("not a url ?token=abc")).toBe("not a url ?token=[REDACTED]");
    expect(sanitizeUrl("?token=abc")).toBe("?token=[REDACTED]");
    expect(() => sanitizeUrl("https://example.com/?%E0%A4%A=1")).not.toThrow();
  });
});

describe("sanitizeUrl userinfo", () => {
  it("redacts user:password credentials in the authority", () => {
    expect(sanitizeUrl("http://user:pass@proxy:8080")).toBe("http://[REDACTED]@proxy:8080");
    expect(sanitizeUrl("http://user:pass@proxy:8080/path")).toBe(
      "http://[REDACTED]@proxy:8080/path",
    );
  });

  it("redacts a bare user@ authority", () => {
    expect(sanitizeUrl("http://user@proxy:8080")).toBe("http://[REDACTED]@proxy:8080");
    expect(sanitizeUrl("user@host")).toBe("[REDACTED]@host");
  });

  it("redacts scheme-less user:pass@host:port", () => {
    expect(sanitizeUrl("user:pass@host:8080")).toBe("[REDACTED]@host:8080");
    expect(sanitizeUrl("user:pass@host:8080/v1")).toBe("[REDACTED]@host:8080/v1");
  });

  it("redacts userinfo in protocol-relative URLs", () => {
    expect(sanitizeUrl("//user:pass@host:8080/path")).toBe("//[REDACTED]@host:8080/path");
  });

  it("keeps @ in path and query untouched", () => {
    expect(sanitizeUrl("https://example.com/users/@me")).toBe("https://example.com/users/@me");
    expect(sanitizeUrl("https://example.com/?email=a@b.com")).toBe(
      "https://example.com/?email=a@b.com",
    );
    expect(sanitizeUrl("https://example.com/path@with-at?x=1")).toBe(
      "https://example.com/path@with-at?x=1",
    );
  });

  it("combines userinfo and query redaction", () => {
    expect(sanitizeUrl("http://user:pass@proxy:8080/api?token=abc&page=2")).toBe(
      "http://[REDACTED]@proxy:8080/api?token=[REDACTED]&page=2",
    );
    expect(sanitizeUrl("user:pass@host:8080?key=secret")).toBe(
      "[REDACTED]@host:8080?key=[REDACTED]",
    );
  });
});

describe("truncation constants", () => {
  it("exports the URL and body truncation limits used by the context builder", () => {
    expect(URL_TRUNCATE_LIMIT).toBe(300);
    expect(BODY_TRUNCATE_LIMIT).toBe(500);
  });

  it("truncate respects a custom limit", () => {
    const long = "x".repeat(400);
    expect(truncate(long, URL_TRUNCATE_LIMIT).length).toBeLessThan(long.length);
    expect(truncate("short", BODY_TRUNCATE_LIMIT)).toBe("short");
  });
});
