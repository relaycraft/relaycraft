import { Suggestion, SuggestionContext, SuggestionProvider } from '../suggestionEngine';

export class ComposerProvider implements SuggestionProvider {
    name = 'ComposerProvider';

    getSuggestions(context: SuggestionContext, t: (key: string, options?: any) => string): Suggestion[] {
        if (!context.aiEnabled || context.activeTab !== 'composer') return [];

        const suggestions: Suggestion[] = [];

        suggestions.push({
            id: 'ai_composer_gen',
            label: t('command_center.suggestions.composer_post_example'),
            action: t('command_center.suggestions.composer_post_example'),
            group: 'ai',
            score: 90
        });

        suggestions.push({
            id: 'ai_composer_upload',
            label: t('command_center.suggestions.ai_composer_upload'),
            action: t('command_center.suggestions.ai_composer_upload'),
            group: 'ai',
            score: 80
        });

        return suggestions;
    }
}
