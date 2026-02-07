import { Suggestion, SuggestionContext, SuggestionProvider } from '../suggestionEngine';

export class PluginProvider implements SuggestionProvider {
    name = 'PluginProvider';

    getSuggestions(context: SuggestionContext, t: (key: string, options?: any) => string): Suggestion[] {
        if (!context.aiEnabled || context.activeTab !== 'plugins') return [];

        const suggestions: Suggestion[] = [];

        suggestions.push({
            id: 'ai_plugin_recommend',
            label: t('command_center.suggestions.ai_plugin_recommend'),
            action: t('command_center.suggestions.ai_plugin_recommend'),
            group: 'ai',
            score: 90
        });

        suggestions.push({
            id: 'ai_plugin_dev',
            label: t('command_center.suggestions.ai_plugin_dev'),
            action: t('command_center.suggestions.ai_plugin_dev'),
            group: 'ai',
            score: 80
        });

        return suggestions;
    }
}
