import { Suggestion, SuggestionContext, SuggestionProvider } from '../suggestionEngine';

export class NavigationProvider implements SuggestionProvider {
    name = 'NavigationProvider';

    getSuggestions(context: SuggestionContext, t: (key: string) => string): Suggestion[] {
        const suggestions: Suggestion[] = [];

        // Base score for navigation commands
        // If input starts with '/', boost score significantly
        const baseScore = context.input.startsWith('/') ? 90 : 10;

        // Static Navigation Commands
        const navCommands = [
            { id: 'nav_traffic', action: '/traffic', label: t('command_center.suggestions.nav_traffic'), name: t('sidebar.traffic') },
            { id: 'nav_rules', action: '/rules', label: t('command_center.suggestions.nav_rules'), name: t('sidebar.rules') },
            { id: 'nav_scripts', action: '/scripts', label: t('command_center.suggestions.nav_scripts'), name: t('sidebar.scripts') },
            { id: 'nav_composer', action: '/composer', label: t('command_center.suggestions.nav_composer'), name: t('sidebar.composer') },
            { id: 'nav_plugins', action: '/plugins', label: t('command_center.suggestions.nav_plugins'), name: t('sidebar.plugins') },
            { id: 'settings', action: '/settings', label: t('command_center.suggestions.settings'), name: t('sidebar.settings') },
            { id: 'clear', action: '/clear', label: t('command_center.suggestions.clear'), name: t('command_center.actions.clear_traffic') },
        ];

        navCommands.forEach(cmd => {
            // Filter out navigation to the current tab
            if (cmd.action === `/${context.activeTab}`) return;

            suggestions.push({
                id: cmd.id,
                label: cmd.label,
                action: cmd.action,
                group: 'navigation',
                score: baseScore,
                description: cmd.id === 'clear'
                    ? cmd.name // "Clear Traffic" directly
                    : t('command_center.suggestions.go_to') + ' ' + cmd.name
            });
        });

        // Proxy Control Commands
        if (context.running) {
            suggestions.push({
                id: 'proxy_stop',
                label: t('command_center.suggestions.proxy_stop'),
                action: '/stop',
                group: 'action',
                score: baseScore + 5 // Slightly higher priority
            });
        } else {
            suggestions.push({
                id: 'proxy_start',
                label: t('command_center.suggestions.proxy_start'),
                action: '/start',
                group: 'action',
                score: baseScore + 5
            });
        }

        // Context-driven adjustments
        // If NO AI, we strict filter in engine, but here we provide all valid base commands.
        // If AI is enabled, these might get outranked by AI prompts unless user types '/'.

        return suggestions;
    }
}
