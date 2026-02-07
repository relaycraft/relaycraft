import { Suggestion, SuggestionContext, SuggestionProvider } from '../suggestionEngine';

export class ScriptProvider implements SuggestionProvider {
    name = 'ScriptProvider';

    getSuggestions(context: SuggestionContext, t: (key: string, options?: any) => string): Suggestion[] {
        if (!context.aiEnabled || context.activeTab !== 'scripts') return [];

        const suggestions: Suggestion[] = [];

        suggestions.push({
            id: 'script_token',
            label: t('command_center.suggestions.script_auth_example'),
            action: t('command_center.suggestions.script_auth_example'),
            group: 'ai',
            score: 80
        });

        suggestions.push({
            id: 'ai_gen_script',
            label: t('command_center.suggestions.script_login_example'),
            action: t('command_center.suggestions.script_login_example'),
            group: 'ai',
            score: 75
        });

        return suggestions;
    }
}
