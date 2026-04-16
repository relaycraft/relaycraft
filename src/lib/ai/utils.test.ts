import { describe, expect, it } from "vitest";
import { normalizeFilterQuery } from "./utils";

describe("normalizeFilterQuery", () => {
  it("normalizes aliases and expands status comma syntax", () => {
    const query = normalizeFilterQuery(
      "status:4xx,5xx host:example.com rb:token body:unauthorized",
    );
    expect(query).toBe(
      "status:4xx status:5xx domain:example.com reqbody:token resbody:unauthorized",
    );
  });

  it("keeps structured header token unchanged", () => {
    const query = normalizeFilterQuery("header:content-type:json");
    expect(query).toBe("header:content-type:json");
  });
});
