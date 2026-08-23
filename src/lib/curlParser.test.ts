import { describe, expect, it } from "vitest";
import { parseCurl } from "./curlParser";

describe("parseCurl", () => {
  it("returns null for non-curl input", () => {
    expect(parseCurl("")).toBeNull();
    expect(parseCurl("wget https://example.com")).toBeNull();
  });

  it("parses a simple GET request", () => {
    const result = parseCurl("curl https://example.com/api");
    expect(result).toEqual({
      method: "GET",
      url: "https://example.com/api",
      headers: {},
      body: null,
    });
  });

  it("parses method, headers and body", () => {
    const result = parseCurl(
      `curl -X PUT -H "Content-Type: application/json" -H "Authorization: Bearer tok" -d '{"a":1}' https://example.com/api`,
    );
    expect(result?.method).toBe("PUT");
    expect(result?.url).toBe("https://example.com/api");
    expect(result?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer tok",
    });
    expect(result?.body).toBe('{"a":1}');
  });

  it("auto-switches to POST when data is present without -X", () => {
    const result = parseCurl(`curl --data-raw "hello world" https://example.com`);
    expect(result?.method).toBe("POST");
    expect(result?.body).toBe("hello world");
  });

  it("handles single quotes and escaped characters", () => {
    const result = parseCurl(`curl -H 'X-Custom: it\\'s' https://example.com`);
    expect(result?.headers["X-Custom"]).toBe("it's");
  });

  it("falls back to the first bare argument as URL", () => {
    const result = parseCurl("curl example.com/api");
    expect(result?.url).toBe("example.com/api");
  });
});
