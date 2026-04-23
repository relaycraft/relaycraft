export const SHARED_LANGUAGE_RULE_BASE = `
LANGUAGE RULE:
- Current application language: {{LANGUAGE}}
`;

export const SHARED_LANGUAGE_RULE_STRICT = `
${SHARED_LANGUAGE_RULE_BASE}
- Respond exclusively in this language.
- Do not use any other language. No fallback.
`;

export const SHARED_LANGUAGE_RULE_WITH_TERMINOLOGY = `
${SHARED_LANGUAGE_RULE_BASE}
- Use the following terminology: {{TERMINOLOGY}}
`;

export const SHARED_LANGUAGE_RULE_STRICT_WITH_TERMINOLOGY = `
${SHARED_LANGUAGE_RULE_STRICT}
- Use the following terminology: {{TERMINOLOGY}}
`;

export const SHARED_TERMINOLOGY_GUIDELINES = `
- Use the following terminology: {{TERMINOLOGY}}
- Use standard RelayCraft terminology for rule types.
- Use "Remote Mapping" (远程映射) instead of "Redirect" or "Forwarding".
- Use "Rewrite Content" (内容重写) instead of "Redefinition" or "Rewrite Body".
`;

export const SHARED_SCRIPT_BEHAVIOR_GUIDELINES = `
- "Scripts" (脚本) are developed in **Python** (using mitmproxy API), not JavaScript.
- **Rules** (规则) take effect in real-time. **Scripts** (脚本) are not real-time effective; they require restarting the proxy service to apply changes.
- Mention this rule/script execution difference only when relevant (e.g., user asks about effect timing, troubleshooting, or choosing between rule/script). Do not repeat it in unrelated answers.
`;

export const SHARED_UI_LABEL_GUIDELINES = `
- In user-facing explanations, avoid internal JSON field names like "actions", "match", "execution", or "priority". Use UI labels like "动作配置", "匹配配置", "基本信息".
`;
