import { useAIStore } from '../../stores/aiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { GLOBAL_COMMAND_SYSTEM_PROMPT, CHAT_RESPONSE_SYSTEM_PROMPT, MITMPROXY_SYSTEM_PROMPT } from './prompts';
import { CommandAction } from '../../stores/commandStore';
import { buildAIContext } from './contextBuilder';
import { AIMessage } from '../../types/ai';
import { Logger } from '../logger';
import { getAILanguageInfo } from './lang';

/**
 * Robustly extracts a JSON object from a potentially messy string.
 */
const extractJson = (text: string): CommandAction | null => {
    let jsonStr = text.trim();
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        const candidate = jsonStr.substring(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (e) {
            // fall through
        }
    }

    if (jsonStr.includes('"intent":') && !jsonStr.startsWith('{')) {
        try {
            return JSON.parse('{' + jsonStr + (jsonStr.endsWith('}') ? '' : '}'));
        } catch (e) {
            // fall through
        }
    }

    return null;
};

/**
 * Lightweight detection of user intent to determine context depth.
 * Optimized to balance token usage and high-signal data.
 */
function detectContextOptions(input: string, activeTab: string | undefined): any {
    const inputLower = input.toLowerCase();
    const options: any = {
        includeLogs: false,
        includeHeaders: false,
        includeBody: false,
        maxTrafficCount: 5
    };

    // Log-related keywords: Only fetch expensive logs if user asks for them
    if (inputLower.match(/log|日志|报错|错误|error|fatal|warn|挂了/)) {
        options.includeLogs = true;
    }

    // Heavy traffic analysis keywords
    if (inputLower.match(/header|头部|body|主体|内容|json|分析|analyze|content/)) {
        options.includeHeaders = true;
        // Deep content check: Only fetch body if specifically looking for data patterns
        if (inputLower.match(/body|内容|主体|json|是什么|查一下/)) {
            options.includeBody = true;
        }
    }

    // Traffic tab context: If we're looking at traffic, headers are usually safe and high-signal
    if (activeTab === 'traffic' && !options.includeHeaders) {
        options.includeHeaders = true;
    }

    return options;
}

export async function dispatchCommand(
    input: string,
    context?: any,
    t?: (key: string, options?: any) => string,
    onChunk?: (content: string) => void
): Promise<CommandAction> {
    const language = useSettingsStore.getState().config.language;
    const translate = t || ((s: string) => s);
    const cleanInput = input.trim();
    const cleanInputLower = cleanInput.toLowerCase();

    // 1. 本地指令匹配 (Slash Commands & Shortcuts)
    const STATIC_COMMANDS: Record<string, CommandAction> = {
        '/clear': { intent: 'CLEAR_TRAFFIC', confidence: 1.0, explanation: translate('command_center.explanations.clear') },
        '/start': { intent: 'TOGGLE_PROXY', params: { action: 'start' }, confidence: 1.0, explanation: translate('command_center.explanations.start') },
        '/stop': { intent: 'TOGGLE_PROXY', params: { action: 'stop' }, confidence: 1.0, explanation: translate('command_center.explanations.stop') },
        '/rules': { intent: 'NAVIGATE', params: { path: '/rules' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_rules') },
        '/scripts': { intent: 'NAVIGATE', params: { path: '/scripts' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_scripts') },
        '/settings': { intent: 'NAVIGATE', params: { path: '/settings' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_settings') },
        '/traffic': { intent: 'NAVIGATE', params: { path: '/traffic' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_traffic') },
        '/composer': { intent: 'NAVIGATE', params: { path: '/composer' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_composer') },
        '/plugins': { intent: 'NAVIGATE', params: { path: '/plugins' }, confidence: 1.0, explanation: translate('command_center.explanations.nav_plugins') },
        '/proxy': { intent: 'OPEN_SETTINGS', params: { category: 'proxy' }, confidence: 1.0, explanation: translate('command_center.explanations.open_proxy') },
        '/cert': { intent: 'NAVIGATE', params: { path: '/certificate' }, confidence: 1.0 },
    };

    if (input.startsWith('/') && STATIC_COMMANDS[cleanInputLower]) {
        return STATIC_COMMANDS[cleanInputLower];
    }

    // 2. AI 是否启用检查
    const { settings: aiSettings, chatCompletion, history, addMessage } = useAIStore.getState();
    if (!aiSettings.enabled) {
        return {
            intent: 'CHAT',
            params: { message: translate('command_center.not_enabled_warning') },
            confidence: 1.0
        };
    }

    // 3. 构建上下文 (Scenario-Aware Context V3)
    const activeTab = useUIStore.getState().activeTab;
    const ctxOptions = detectContextOptions(input, activeTab);
    const fullContext = await buildAIContext(ctxOptions);
    const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

    const langInfo = getAILanguageInfo();
    const intentSystemMsg: AIMessage = {
        role: 'system' as const,
        content: GLOBAL_COMMAND_SYSTEM_PROMPT
            .replace(/{{LANGUAGE}}/g, langInfo.name)
            .replace(/{{CONTEXT}}/g, contextString)
            .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
            .replace(/{{ACTIVE_TAB}}/g, activeTab)
    };

    const userMsg: AIMessage = { role: 'user' as const, content: input };

    try {
        const intentResponse = await chatCompletion([intentSystemMsg, ...history, userMsg], 0);
        let action = extractJson(intentResponse);

        if (!action) {
            action = {
                intent: 'CHAT',
                params: { message: intentResponse },
                confidence: 0.5
            };
        } else {
            // Robustness: ensure intent is always present and normalized
            const validIntents = ['NAVIGATE', 'CREATE_RULE', 'CREATE_SCRIPT', 'TOGGLE_PROXY', 'OPEN_SETTINGS', 'GENERATE_REQUEST', 'CHAT', 'CLEAR_TRAFFIC'];
            const normalizedIntent = (action.intent || 'CHAT').toUpperCase();

            if (!validIntents.includes(normalizedIntent)) {
                action.intent = 'CHAT';
            } else {
                action.intent = normalizedIntent as any;
            }
        }

        // 两段式对话生成
        if (action.intent === 'CHAT' || (action.intent === 'CREATE_SCRIPT' && action.params?.requirement)) {
            return await runTwoStageChat(input, context, action, language, translate, onChunk);
        }

        addMessage('user', input);
        return action;
    } catch (error) {
        Logger.error('AI Recognition Failed', error);
        throw error; // Propagate error to UI for better handling
    }
}

/**
 * Handles the second stage of AI interaction: streaming chat response.
 * Uses the same context-awareness logic but potentially deeper.
 */
async function runTwoStageChat(
    input: string,
    context: any,
    action: CommandAction,
    _language: string,
    _translate: (key: string) => string,
    onChunk?: (content: string) => void
): Promise<CommandAction> {
    const { chatCompletionStream, history, addMessage } = useAIStore.getState();
    const activeTab = useUIStore.getState().activeTab;
    const ctxOptions = detectContextOptions(input, activeTab);
    const fullContext = await buildAIContext(ctxOptions);
    const contextString = JSON.stringify({ ...fullContext, ...context }, null, 2);

    const isScriptIntent = action.intent === 'CREATE_SCRIPT';
    const systemPrompt = isScriptIntent ? MITMPROXY_SYSTEM_PROMPT : CHAT_RESPONSE_SYSTEM_PROMPT;

    const langInfo = getAILanguageInfo();
    const chatSystemMsg: AIMessage = {
        role: 'system' as const,
        content: systemPrompt
            .replace(/{{LANGUAGE}}/g, langInfo.name)
            .replace(/{{CONTEXT}}/g, contextString)
            .replace(/{{TERMINOLOGY}}/g, langInfo.terminology)
            .replace(/{{ACTIVE_TAB}}/g, activeTab)
    };

    const userMsg: AIMessage = { role: 'user' as const, content: input };
    let fullChatResponse = '';

    await chatCompletionStream([chatSystemMsg, ...history, userMsg], (chunk) => {
        fullChatResponse += chunk;
        if (onChunk) onChunk(chunk);
    });

    addMessage('user', input);
    addMessage('assistant', fullChatResponse);

    return {
        ...action,
        params: { ...action.params, message: fullChatResponse }
    };
}
