import yaml from 'js-yaml';

/**
 * Parse YAML string to typed object
 */
export function parseYAML<T>(content: string): T {
    try {
        return yaml.load(content) as T;
    } catch (error) {
        const err = error as Error;
        throw new Error(`YAML parse error: ${err.message}`);
    }
}

/**
 * Convert object to YAML string
 */
export function stringifyYAML<T>(data: T): string {
    return yaml.dump(data, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
        sortKeys: false,
        quotingType: '"',
        forceQuotes: false,
    });
}

/**
 * Convert JSON string to YAML string
 */
export function convertJSONtoYAML(json: string): string {
    const data = JSON.parse(json);
    return stringifyYAML(data);
}

/**
 * Convert YAML string to JSON string
 */
export function convertYAMLtoJSON(yamlContent: string): string {
    const data = parseYAML(yamlContent);
    return JSON.stringify(data, null, 2);
}

/**
 * Validate YAML syntax without parsing
 */
export function validateYAML(content: string): { valid: boolean; error?: string } {
    try {
        yaml.load(content);
        return { valid: true };
    } catch (error) {
        const err = error as Error;
        return { valid: false, error: err.message };
    }
}

const VALID_RULE_TYPES = ['map_local', 'map_remote', 'rewrite_header', 'rewrite_body', 'throttle', 'block_request'];

/**
 * Semantic validation of a Rule object
 */
export function validateRuleSchema(rule: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!rule) {
        return { valid: false, errors: ['rules.validation.empty'] };
    }

    if (!rule.name || typeof rule.name !== 'string') {
        errors.push('rules.validation.missing_name');
    }

    if (!rule.type || !VALID_RULE_TYPES.includes(rule.type)) {
        errors.push('rules.validation.invalid_type');
    }

    if (!rule.match || typeof rule.match !== 'object') {
        errors.push('rules.validation.missing_match');
    } else {
        if (!Array.isArray(rule.match.request)) {
            errors.push('rules.validation.match_request_array');
        }
    }

    if (!Array.isArray(rule.actions)) {
        errors.push('rules.validation.actions_array');
    } else if (rule.actions.length === 0) {
        errors.push('rules.validation.min_actions');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
