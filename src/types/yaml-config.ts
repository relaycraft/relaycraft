/**
 * YAML Configuration Types
 * These types represent the YAML file structure for rules and plugins
 */

import { Rule, RuleGroup } from './rules';

// ============================================================================
// Rules Configuration (rules.yaml)
// ============================================================================

export interface RulesYAMLConfig {
    version: string;
    groups?: RuleGroup[];
    rules: Rule[];
}

// ============================================================================
// Plugins Configuration (plugins.yaml)
// ============================================================================

export interface PluginsYAMLConfig {
    version: string;
    plugins: PluginConfig[];
}

export interface PluginConfig {
    id: string;
    name: string;
    enabled: boolean;
    description?: string;
    type: 'script' | 'builtin';
    priority: number;
    groupId?: string;
    stopOnMatch?: boolean;
    tags?: string[];
    script?: string;  // Path to script file (for type: script)
    config?: Record<string, any>;  // Flexible plugin-specific configuration
}

// ============================================================================
// Legacy JSON Support (for migration)
// ============================================================================

export interface LegacyRulesJSON {
    rules: Rule[];
    groups?: RuleGroup[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create default YAML config
 */
export function createDefaultRulesConfig(): RulesYAMLConfig {
    return {
        version: '1.0',
        rules: [],
    };
}

/**
 * Create default plugins config
 */
export function createDefaultPluginsConfig(): PluginsYAMLConfig {
    return {
        version: '1.0',
        plugins: [],
    };
}
