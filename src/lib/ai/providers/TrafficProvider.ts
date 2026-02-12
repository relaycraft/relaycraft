import type {
	Suggestion,
	SuggestionContext,
	SuggestionProvider,
} from "../suggestionEngine";

export class TrafficProvider implements SuggestionProvider {
	name = "TrafficProvider";

	getSuggestions(
		context: SuggestionContext,
		t: (key: string, options?: any) => string,
	): Suggestion[] {
		if (!context.aiEnabled) return [];

		const suggestions: Suggestion[] = [];
		const isTrafficTab = context.activeTab === "traffic";

		// 1. Context: Traffic Tab Active
		if (isTrafficTab) {
			if (context.selectedFlow) {
				// High Priority: Selected Flow Actions
				suggestions.push({
					id: "flow_analysis",
					label: t("command_center.suggestions.traffic_analyze", {
						method: context.selectedFlow.request.method,
					}),
					action: t("command_center.suggestions.traffic_analyze", {
						method: context.selectedFlow.request.method,
					}),
					group: "ai",
					score: 100,
				});
				suggestions.push({
					id: "ai_analyze_security",
					label: t("command_center.suggestions.traffic_security"),
					action: t("command_center.suggestions.traffic_security"),
					group: "ai",
					score: 90,
				});
			} else {
				// Global Traffic Insights
				suggestions.push({
					id: "ai_analyze_traffic_trend",
					label: t("command_center.suggestions.traffic_trends"),
					action: t("command_center.suggestions.traffic_trends"),
					group: "ai",
					score: 80,
				});
				suggestions.push({
					id: "ai_find_errors",
					label: t("command_center.suggestions.traffic_anomalies"),
					action: t("command_center.suggestions.traffic_anomalies"),
					group: "ai",
					score: 75,
				});
			}
		}

		return suggestions;
	}
}
