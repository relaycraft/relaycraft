import type {
	Suggestion,
	SuggestionContext,
	SuggestionProvider,
} from "../suggestionEngine";

export class RulesProvider implements SuggestionProvider {
	name = "RulesProvider";

	getSuggestions(
		context: SuggestionContext,
		t: (key: string, options?: any) => string,
	): Suggestion[] {
		if (!context.aiEnabled || context.activeTab !== "rules") return [];

		const suggestions: Suggestion[] = [];

		if (context.selectedRule) {
			suggestions.push({
				id: "ai_explain_rule",
				label: t("command_center.suggestions.ai_explain_rule"),
				action: t("command_center.suggestions.ai_explain_rule"),
				group: "ai",
				score: 100,
			});
		}

		suggestions.push({
			id: "rule_conflict",
			label: t("command_center.suggestions.rule_conflict"),
			action: t("command_center.suggestions.rule_conflict"),
			group: "ai",
			score: 80,
		});

		suggestions.push({
			id: "rule_google",
			label: t("command_center.suggestions.rule_block_example"),
			action: t("command_center.suggestions.rule_block_example"),
			group: "ai",
			score: 70,
		});

		return suggestions;
	}
}
