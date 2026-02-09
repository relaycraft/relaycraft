import type { Rule } from "../../types/rules";

export interface AIRule extends Partial<Rule> {
	// Legacy support (optional) in case AI hallucinates old structure
	match?: any;
	action?: any;
}

/**
 * Maps the AI rule format (strict or legacy) to the internal application Rule structure.
 */
export function mapAIRuleToInternal(aiRule: AIRule): Partial<Rule> {
	if (!aiRule) return { type: "block_request" };

	// 1. Base Mapping
	const baseRule: Partial<Rule> = {
		name: aiRule.name || "AI Suggested Rule",
		type: aiRule.type || "block_request",
		execution: {
			enabled: aiRule.execution?.enabled ?? (aiRule as any).enabled ?? true,
			priority: aiRule.execution?.priority ?? (aiRule as any).priority ?? 1,
			stopOnMatch:
				aiRule.execution?.stopOnMatch ?? (aiRule as any).stopOnMatch ?? true,
		},
		match: {
			request: [],
			response: [],
		},
		actions: [],
	};

	// 2. Normalize Match (Handle Array vs Object)
	if (Array.isArray(aiRule.match)) {
		baseRule.match!.request = aiRule.match.map((m) => ({
			...m,
			// Map 'path' or 'host' to 'url' if it's the only match to ensure UI compatibility
			type: m.type === "path" || m.type === "host" ? "url" : m.type,
		}));
	} else if (aiRule.match && typeof aiRule.match === "object") {
		if (aiRule.match.request || aiRule.match.response) {
			baseRule.match = {
				request: (aiRule.match.request || []).map((m: any) => ({
					...m,
					type: m.type === "path" || m.type === "host" ? "url" : m.type,
					matchType: m.matchType || m.match_type || m.mode || "contains",
					value: m.value || m.pattern || m.match || "",
				})),
				response: (aiRule.match.response || []).map((m: any) => ({
					...m,
					matchType: m.matchType || m.match_type || m.mode || "contains",
					value: m.value || m.pattern || m.match || "",
				})),
			};
		} else {
			const m = aiRule.match as any;
			// Legacy conversion
			if (m.url) {
				baseRule.match!.request.push({
					type: "url",
					matchType: m.mode || "contains",
					value: m.url,
				});
			}
		}
	}

	// 3. Normalize Actions (Handle Array vs Object)
	if (Array.isArray(aiRule.actions)) {
		baseRule.actions = aiRule.actions.map((a) => {
			const action = { ...a } as any;
			// Simple V2 -> V3 for common hallucinations
			if (
				action.type === "rewrite_body" &&
				action.rewriteType &&
				!action.set &&
				!action.replace &&
				!action.regex_replace &&
				!action.json
			) {
				const rt = action.rewriteType;
				if (rt === "set") {
					action.set = {
						content: action.content || "",
						statusCode: action.statusCode,
						contentType: action.contentType,
					};
				} else if (rt === "replace") {
					action.replace = {
						pattern: action.pattern || "",
						replacement: action.replacement || "",
					};
				}
				delete action.rewriteType;
				delete action.content;
				delete action.statusCode;
				delete action.contentType;
				delete action.pattern;
				delete action.replacement;
			}
			return action;
		});
	} else if (aiRule.action) {
		baseRule.actions!.push(aiRule.action);
	}

	// 4. Fallback if empty (should not happen with strict prompt)
	if (
		!baseRule.match ||
		(baseRule.match.request.length === 0 &&
			baseRule.match.response.length === 0)
	) {
		// Default to match all if missing? Or leave empty.
	}

	// 5. Ensure actions array exists
	if (!baseRule.actions) {
		baseRule.actions = [];
	}

	return baseRule;
}
