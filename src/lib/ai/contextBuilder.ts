import { invoke } from "@tauri-apps/api/core";
import { useProxyStore } from "../../stores/proxyStore";
import { useRuleStore } from "../../stores/ruleStore";
import { useScriptStore } from "../../stores/scriptStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTrafficStore } from "../../stores/trafficStore";
import { useUIStore } from "../../stores/uiStore";
import type { AIContext, AIContextOptions } from "../../types/ai";
import type { Rule } from "../../types/rules";

/**
 * Generates a human-readable summary of a single rule.
 */
const summarizeRule = (rule: Rule): { match: string; action: string } => {
	// Basic match summary
	const matches = rule.match.request
		.map((atom) => {
			if (atom.type === "url")
				return `${atom.matchType === "regex" ? "Regex" : "URL"}: ${atom.value}`;
			if (atom.type === "method") return `Method: ${atom.value}`;
			if (atom.type === "host") return `Host: ${atom.value}`;
			if (atom.type === "path") return `Path: ${atom.value}`;
			return `${atom.type}=${atom.value}`;
		})
		.join(" AND ");

	// Basic action summary
	const actions = rule.actions
		.map((action) => {
			switch (action.type) {
				case "map_local":
					return `Map Local -> ${(action as any).localPath || "Manual"}`;
				case "map_remote":
					return `Map Remote -> ${(action as any).targetUrl}`;
				case "block_request":
					return "Block";
				case "rewrite_body":
					return `Rewrite Body (${(action as any).target})`;
				case "rewrite_header":
					return `Rewrite Header (${(action as any).target})`;
				case "throttle":
					return "Throttle";
				default:
					return (action as any).type;
			}
		})
		.join(", ");

	return { match: matches, action: actions };
};

/**
 * Truncates strings with elite precision to preserve high-signal start/end.
 */
const truncate = (val: string, limit: number = 200): string => {
	if (!val || val.length <= limit) return val;
	return (
		val.substring(0, limit) + `... [TRUNCATED ${val.length - limit} chars]`
	);
};

/**
 * Strips sensitive/bulky headers to save tokens.
 */
const sanitizeHeaders = (
	headers: Record<string, string>,
): Record<string, string> => {
	const blacklist = [
		"cookie",
		"set-cookie",
		"authorization",
		"proxy-authorization",
	];
	const sanitized: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (blacklist.includes(k.toLowerCase())) {
			sanitized[k] = "[SENSITIVE_REDACTED]";
		} else {
			sanitized[k] = truncate(v, 100);
		}
	}
	return sanitized;
};

/**
 * Builds the AI Context snapshot from current stores.
 */
export const buildAIContext = async (
	options: AIContextOptions = {},
): Promise<AIContext> => {
	const {
		includeLogs = false,
		includeHeaders = false,
		includeBody = false,
		maxTrafficCount = 5,
	} = options;

	// 1. Get Stores
	const { rules, selectedRule, draftRule } = useRuleStore.getState();
	const { scripts } = useScriptStore.getState();
	const { port } = useProxyStore.getState();
	const { config } = useSettingsStore.getState();
	const { flows, selectedFlow } = useTrafficStore.getState();
	const { activeTab } = useUIStore.getState();

	// 2. Filter Active Rules
	const activeRules = rules
		.filter((r) => r.execution.enabled !== false)
		.map((r) => {
			const summary = summarizeRule(r);
			return {
				id: r.id,
				name: r.name,
				type: r.type as string,
				match: summary.match,
				actionSummary: summary.action,
			};
		});

	// 3. Filter Active Scripts
	const activeScripts = scripts.filter((s) => s.enabled).map((s) => s.name);

	// 4. Sample Recent Traffic
	const recentTraffic = flows
		.slice(-maxTrafficCount)
		.map((f) => ({
			id: f.id,
			method: f.method,
			url: truncate(f.url, 150),
			status: f.statusCode,
		}))
		.reverse();

	// 5. Fetch Real Logs if requested
	let recentLogs: string[] = [];
	if (includeLogs) {
		try {
			// Fetch last 10 engine logs
			recentLogs = await invoke("get_logs", { logName: "proxy", lines: 10 });
		} catch (e) {
			recentLogs = ["Error fetching system logs."];
		}
	}

	// 6. Focus Item Details (Deep Snapshot)
	let selectedItem: AIContext["selectedItem"];
	if (activeTab === "traffic" && selectedFlow) {
		selectedItem = {
			type: "flow",
			id: selectedFlow.id,
			details: {
				method: selectedFlow.method,
				url: selectedFlow.url,
				statusCode: selectedFlow.statusCode,
				requestHeaders: includeHeaders
					? sanitizeHeaders(selectedFlow.requestHeaders)
					: undefined,
				responseHeaders: includeHeaders
					? sanitizeHeaders(selectedFlow.responseHeaders)
					: undefined,
				requestBody: includeBody
					? truncate(selectedFlow.requestBody || "", 500)
					: undefined,
				responseBody: includeBody
					? truncate(selectedFlow.responseBody || "", 500)
					: undefined,
			},
		};
	} else if (activeTab === "rules" && (selectedRule || draftRule)) {
		const target = selectedRule || draftRule;
		if (target) {
			selectedItem = {
				type: "rule",
				id: target.id || (target as any)._draftId || "draft",
				details: target,
			};
		}
	}

	// 7. Generate Narrative Summary
	let summary = `System on port ${port}. Tab: ${activeTab}. `;
	if (config.upstream_proxy?.enabled) {
		summary += `Upstream: ${config.upstream_proxy.url}. `;
	}
	if (selectedFlow) summary += `Focused on: ${selectedFlow.url}. `;

	return {
		summary,
		activeRules,
		activeScripts,
		recentTraffic,
		recentLogs,
		selectedItem,
		activeTab: activeTab || undefined,
		system: {
			proxyPort: port,
			upstreamProxy: config.upstream_proxy?.enabled
				? config.upstream_proxy.url
				: undefined,
			version: "0.9.9",
		},
	};
};
