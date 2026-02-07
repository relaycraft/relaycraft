import { useRef, useEffect, useState } from 'react';
import { Editor } from '../common/Editor';
import { EmptyState } from '../common/EmptyState';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Save, Check, Sparkles, RotateCcw, Plus, X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useScriptStore } from '../../stores/scriptStore';
import { AIScriptAssistant } from '../ai/AIScriptAssistant';
import { useAIStore } from '../../stores/aiStore';
import { useUIStore } from '../../stores/uiStore';
import { Button } from '../common/Button';
import { notify } from '../../lib/notify';
import { Tooltip } from '../common/Tooltip';
import { cn } from '../../lib/utils';

interface ScriptEditorProps {
    scriptName: string | null;
    onSave?: () => void;
}

export function ScriptEditor({ scriptName, onSave }: ScriptEditorProps) {
    const { getScriptContent, saveScript, renameScript, draftScript, setDraftScript } = useScriptStore();
    const { draftScriptPrompt } = useUIStore();
    const { t } = useTranslation();
    const [content, setContent] = useState<string>('');

    // Rename/Draft name state
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [showAI, setShowAI] = useState(false);
    const editorViewRef = useRef<any>(null);
    const { settings: aiSettings } = useAIStore();

    // Auto-AI Trigger from global command center
    const { draftScriptCode, setDraftScriptCode } = useUIStore();

    // Template
    const DEFAULT_TEMPLATE = `"""
Addon Script for RelayCraft
"""
from mitmproxy import http, ctx

class Addon:
    def request(self, flow: http.HTTPFlow):
        # TODO: Add your logic
        pass

addons = [Addon()]
`;

    useEffect(() => {
        if (draftScriptCode) {
            // If we have draft code coming from UI store (e.g. from CC), set it as a draft if none exists
            if (!draftScript && !scriptName) {
                setDraftScript({ name: 'Generated Script.py', content: draftScriptCode });
            } else {
                setContent(draftScriptCode);
            }
            setDraftScriptCode(null);
        } else if (draftScriptPrompt) {
            setShowAI(true);
        }
    }, [draftScriptPrompt, draftScriptCode, scriptName, draftScript]);

    // Load content based on scriptName or draftScript
    useEffect(() => {
        const load = async () => {
            if (scriptName) {
                setLoading(true);
                try {
                    const code = await getScriptContent(scriptName);
                    setContent(code || DEFAULT_TEMPLATE);
                } catch (error) {
                    console.error("Failed to load script", error);
                    setContent(DEFAULT_TEMPLATE);
                } finally {
                    setLoading(false);
                }
            } else if (draftScript) {
                setContent(draftScript.content);
                setRenameValue(draftScript.name);
                setLoading(false);
            }
        };
        load();
    }, [scriptName, draftScript, getScriptContent]);

    const handleEditorCreate = (view: any) => {
        editorViewRef.current = view;
    };

    const handleStartRename = () => {
        setRenameValue(scriptName || (draftScript?.name || ''));
        setIsRenaming(true);
    };

    const handleConfirmRename = async () => {
        let newName = renameValue.trim();
        if (!newName) {
            setIsRenaming(false);
            return;
        }
        if (!newName.endsWith('.py')) newName += '.py';

        if (scriptName) {
            if (newName === scriptName) {
                setIsRenaming(false);
                return;
            }
            try {
                await renameScript(scriptName, newName);
            } catch (error) {
                console.error('Failed to rename script:', error);
            }
        } else if (draftScript) {
            setDraftScript({ ...draftScript, name: newName });
        }
        setIsRenaming(false);
    };

    // Determine if AI is currently pushing code
    const [isSyncing, setIsSyncing] = useState(false);

    // Listen to AI assistant events or use a simple heuristic: 
    // If showAI is true and content is changing rapidly (handled via a prop if we were more coupled, 
    // but here we can just use the assistant's state if we exposed it, or a simple timeout).
    // Better: ScriptEditor is the one receiving onApply. 
    // I'll add a way for ScriptEditor to know it's syncing.

    const handleSave = async () => {
        if (saving) return;
        const targetName = scriptName || draftScript?.name;
        if (!targetName) return;

        setSaving(true);
        try {
            await saveScript(targetName, content);
            setSaved(true);
            onSave?.();
            notify.success(t('script_editor.saved'));
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            notify.error(t('scripts.save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const handleRevert = async () => {
        if (!scriptName) {
            setContent(DEFAULT_TEMPLATE);
            return;
        }
        setLoading(true);
        try {
            const code = await getScriptContent(scriptName);
            setContent(code || DEFAULT_TEMPLATE);
            notify.success(t('script_editor.revert_success'));
        } catch (error) {
            notify.error(t('script_editor.revert_fail'));
        } finally {
            setLoading(false);
        }
    };



    if (!scriptName && !draftScript) {
        return (
            <EmptyState
                icon={FileText}
                title={t('scripts.select_title')}
                description={t('scripts.select_desc')}
                animation="float"
            />
        );
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background transition-colors duration-300 relative">
            <div className="flex items-center justify-between p-2 border-b border-border bg-card select-none">
                <div className="flex items-center gap-2">
                    {isRenaming ? (
                        <input
                            autoFocus
                            type="text"
                            className="w-80 px-2 py-1 text-sm font-mono font-medium bg-muted/30 border border-primary/30 rounded focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleConfirmRename();
                                if (e.key === 'Escape') setIsRenaming(false);
                            }}
                            onBlur={handleConfirmRename}
                        />
                    ) : (
                        <div
                            className="text-sm font-mono font-medium px-2 py-1 text-foreground hover:bg-muted/50 rounded cursor-text transition-colors flex items-center gap-2 group w-fit"
                            onClick={handleStartRename}
                            title={t('common.double_click_rename')}
                        >
                            {!scriptName && <Plus className="w-3.5 h-3.5 text-primary" />}
                            <span className="truncate max-w-[300px] text-[11px] font-bold">{scriptName || draftScript?.name}</span>
                            {!scriptName && <span className="text-[9px] bg-primary/10 text-primary px-1 rounded uppercase font-sans font-black">Draft</span>}
                            <span className="opacity-0 group-hover:opacity-100 text-xs font-sans text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                                {t('common.double_click_rename')}
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {aiSettings.enabled && (
                        <Tooltip content={t('script_editor.ai_helper')}>
                            <Button
                                variant="quiet"
                                size="sm"
                                onClick={() => setShowAI(true)}
                                className="gap-1.5"
                            >
                                <Sparkles className="w-3.5 h-3.5 text-primary" />
                                {t('script_editor.ai_helper')}
                            </Button>
                        </Tooltip>
                    )}

                    {!scriptName && (
                        <Button
                            variant="quiet"
                            size="sm"
                            onClick={() => setDraftScript(null)}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <X className="w-3.5 h-3.5 mr-1" />
                            {t('common.cancel')}
                        </Button>
                    )}

                    {scriptName && (
                        <Tooltip content={t('script_editor.revert_hint')}>
                            <Button
                                onClick={handleRevert}
                                variant="quiet"
                                size="sm"
                                disabled={loading || saving}
                                className="gap-1.5"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                {t('common.reset')}
                            </Button>
                        </Tooltip>
                    )}

                    <Button
                        onClick={handleSave}
                        disabled={saving || saved}
                        className={cn(
                            "gap-1.5 min-w-[100px] transition-all duration-300 shadow-sm",
                            saved && "bg-green-500/10 text-green-500 border-green-500/20"
                        )}
                        variant={saved ? "outline" : "default"}
                        size="sm"
                    >
                        {saving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : saved ? (
                            <Check className="w-3.5 h-3.5" />
                        ) : (
                            <Save className="w-3.5 h-3.5" />
                        )}
                        {!scriptName ? t('scripts.save_script') : (saving ? t('script_editor.saving') : saved ? t('script_editor.saved') : t('script_editor.save_hint'))}
                    </Button>
                </div>
            </div>

            <AnimatePresence>
                {showAI && (
                    <AIScriptAssistant
                        isCreateMode={!scriptName && (!content || content === DEFAULT_TEMPLATE)}
                        currentCode={content}
                        onClose={() => setShowAI(false)}
                        onApply={(code: string, name?: string) => {
                            setContent(code);
                            if (!scriptName && name) {
                                setDraftScript({ name, content: code });
                            }
                            setIsSyncing(true);
                            setTimeout(() => setIsSyncing(false), 2000);
                        }}
                    />
                )}
            </AnimatePresence>

            <div className="flex-1 overflow-hidden relative group/editor">
                <AnimatePresence>
                    {isSyncing && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
                        >
                            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-pulse" />
                            <div className="absolute inset-0 bg-primary/[0.02] shadow-[inset_0_0_60px_rgba(var(--primary-rgb),0.05)]" />
                        </motion.div>
                    )}
                </AnimatePresence>

                <Editor
                    height="100%"
                    language="python"
                    value={content}
                    onChange={setContent}
                    onCreateEditor={handleEditorCreate}
                    options={{
                        lineNumbers: 'on',
                        tabSize: 4,
                    }}
                />
            </div>
        </div>
    );
}
