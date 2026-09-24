/**
 * Curated built-in rule templates.
 *
 * Exactly two code-defined templates — no file dependency, no persistence
 * side effect, no shared mutable state. Each call returns a fresh draft
 * object the rule editor can adopt via `setDraftRule`.
 *
 * Safety contract: every template uses an `exact` URL match against a
 * harmless example.com placeholder, ships `enabled: false`, and keeps that
 * flag through `buildRuleForSave` — a template cannot affect traffic
 * until the user enables it explicitly.
 */

import { getNextRulePriority } from "../../stores/ruleStore";
import type { Rule } from "../../types/rules";

export const RULE_TEMPLATE_IDS = ["block_request", "map_local_json"] as const;
export type RuleTemplateId = (typeof RULE_TEMPLATE_IDS)[number];

/**
 * Build a fresh draft rule for `templateId`. `translatedName` is provided
 * by the caller so this module stays i18n-free.
 *
 * The draft intentionally carries no `id` and no `metadata` — it is a new
 * unsaved rule, not a provenance-marked import.
 */
export function buildTemplateDraft(
  templateId: RuleTemplateId,
  translatedName: string,
): Partial<Rule> {
  switch (templateId) {
    case "block_request":
      return {
        name: translatedName,
        type: "block_request",
        match: {
          request: [{ type: "url", matchType: "exact", value: "https://example.com/blocked" }],
          response: [],
        },
        actions: [{ type: "block_request" }],
        execution: {
          enabled: false,
          priority: getNextRulePriority(),
          stopOnMatch: true,
        },
      };
    case "map_local_json":
      return {
        name: translatedName,
        type: "map_local",
        match: {
          request: [
            {
              type: "url",
              matchType: "exact",
              value: "https://example.com/api/example",
            },
          ],
          response: [],
        },
        actions: [
          {
            type: "map_local",
            source: "manual",
            content: '{"message":"hello"}',
            contentType: "application/json",
            statusCode: 200,
          },
        ],
        execution: {
          enabled: false,
          priority: getNextRulePriority(),
          stopOnMatch: true,
        },
      };
  }
}
