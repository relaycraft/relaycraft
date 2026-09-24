import { describe, expect, it, vi } from "vitest";
import {
  buildActionsForSave,
  buildMatchRequest,
  buildRuleForSave,
  parseActionsToState,
} from "../../components/rules/hooks/ruleEditorSerialization";
import type { Rule } from "../../types/rules";
import { buildTemplateDraft, RULE_TEMPLATE_IDS } from "./ruleTemplates";

vi.mock("../../stores/ruleStore", () => ({
  getNextRulePriority: () => 99,
}));

/**
 * Mirror the editor save path: draft → flat action state → built actions →
 * buildRuleForSave. This is what "Save" actually does with a template draft.
 */
function saveDraftLikeEditor(draft: ReturnType<typeof buildTemplateDraft>): Rule {
  const parsed = parseActionsToState(draft.actions ?? []);
  const matchRequest = buildMatchRequest(
    (draft.match?.request?.find((a) => a.type === "url")?.value as string) || "",
    (draft.match?.request?.find((a) => a.type === "url")?.matchType as never) || "contains",
    [],
    [],
  );
  const actions = buildActionsForSave(draft.type!, {
    rewriteBody: {
      target: parsed.rewriteTarget,
      type: parsed.rewriteType,
      content: parsed.rewriteContent,
      pattern: parsed.rewritePattern,
      replacement: parsed.rewriteReplacement,
      modifications: parsed.jsonModifications,
      statusCode: parsed.rewriteStatusCode,
      contentType: parsed.rewriteContentType,
    },
    mapLocal: {
      source: parsed.mapLocalSource,
      localPath: parsed.localPath,
      content: parsed.mapLocalContent,
      contentType: parsed.contentType,
      statusCode: parsed.mapLocalStatusCode,
    },
    mapRemote: { targetUrl: parsed.targetUrl, preservePath: parsed.preservePath },
    throttle: {
      delayMs: parsed.delayMs,
      packetLoss: parsed.packetLoss,
      bandwidthKbps: parsed.bandwidthKbps,
    },
    headersRequest: parsed.headersRequest,
    headersResponse: parsed.headersResponse,
  });
  return buildRuleForSave(draft, draft.name ?? "", draft.type!, matchRequest, actions);
}

describe("buildTemplateDraft", () => {
  it("covers exactly the two curated template ids", () => {
    expect(RULE_TEMPLATE_IDS).toEqual(["block_request", "map_local_json"]);
  });

  it("builds a disabled block_request draft with a narrow exact URL match", () => {
    const draft = buildTemplateDraft("block_request", "Block URL");

    expect(draft.id).toBeUndefined();
    expect(draft.metadata).toBeUndefined();
    expect(draft.name).toBe("Block URL");
    expect(draft.type).toBe("block_request");
    expect(draft.match?.request).toEqual([
      { type: "url", matchType: "exact", value: "https://example.com/blocked" },
    ]);
    expect(draft.match?.response).toEqual([]);
    expect(draft.actions).toEqual([{ type: "block_request" }]);
    expect(draft.execution).toEqual({
      enabled: false,
      priority: 99,
      stopOnMatch: true,
    });
  });

  it("builds a disabled manual map_local draft with a narrow exact URL match", () => {
    const draft = buildTemplateDraft("map_local_json", "Mock JSON");

    expect(draft.id).toBeUndefined();
    expect(draft.metadata).toBeUndefined();
    expect(draft.type).toBe("map_local");
    expect(draft.match?.request).toEqual([
      { type: "url", matchType: "exact", value: "https://example.com/api/example" },
    ]);
    expect(draft.actions).toEqual([
      {
        type: "map_local",
        source: "manual",
        content: '{"message":"hello"}',
        contentType: "application/json",
        statusCode: 200,
      },
    ]);
    expect(draft.execution?.enabled).toBe(false);
    expect(draft.execution?.stopOnMatch).toBe(true);
    expect(draft.execution?.priority).toBe(99);
  });

  it("returns fresh independent objects on every call", () => {
    const a = buildTemplateDraft("map_local_json", "A");
    const b = buildTemplateDraft("map_local_json", "B");

    expect(a).not.toBe(b);
    expect(a.match).not.toBe(b.match);
    expect(a.actions).not.toBe(b.actions);
    expect(a.execution).not.toBe(b.execution);
    expect(a.match?.request).not.toBe(b.match?.request);

    (a.match!.request[0] as { value: string }).value = "https://mutated.example";
    (a.actions![0] as { content: string }).content = "mutated";

    expect(b.match!.request[0].value).toBe("https://example.com/api/example");
    expect((b.actions![0] as { content: string }).content).toBe('{"message":"hello"}');
  });

  it("keeps execution.enabled=false and priority through the editor save path", () => {
    const draft = buildTemplateDraft("block_request", "Block URL");
    const saved = saveDraftLikeEditor(draft);

    expect(saved.execution.enabled).toBe(false);
    expect(saved.execution.priority).toBe(99);
    expect(saved.execution.stopOnMatch).toBe(true);
    expect(saved.match.request).toEqual([
      { type: "url", matchType: "exact", value: "https://example.com/blocked" },
    ]);
    expect(saved.actions).toEqual([{ type: "block_request" }]);
    // The editor save path assigns an id; the draft itself still has none.
    expect(saved.id).toBeTruthy();
    expect(draft.id).toBeUndefined();
  });

  it("preserves the manual map_local action through the editor save path", () => {
    const draft = buildTemplateDraft("map_local_json", "Mock JSON");
    const saved = saveDraftLikeEditor(draft);

    expect(saved.execution.enabled).toBe(false);
    expect(saved.actions).toEqual([
      {
        type: "map_local",
        source: "manual",
        localPath: undefined,
        content: '{"message":"hello"}',
        contentType: "application/json",
        statusCode: 200,
        headers: undefined,
      },
    ]);
  });
});
