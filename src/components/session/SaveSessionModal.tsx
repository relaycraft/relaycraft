import React, { useState, useEffect } from 'react';
import { Save, Type, AlignLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

export function SaveSessionModal() {
    const { saveSessionModalOpen, setSaveSessionModalOpen } = useUIStore();
    const { saveSession, loading } = useSessionStore();
    const { t } = useTranslation();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (saveSessionModalOpen) {
            const date = new Date();
            setName(`Session ${date.toLocaleDateString().replace(/\//g, '-')} ${date.toLocaleTimeString().replace(/:/g, '-')}`);
            setDescription('');
        }
    }, [saveSessionModalOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        await saveSession(name, description);
        setSaveSessionModalOpen(false);
    };

    return (
        <Modal
            isOpen={saveSessionModalOpen}
            onClose={() => setSaveSessionModalOpen(false)}
            title={t('save_session.title')}
            className="max-w-md"
            icon={<Save className="w-4 h-4 text-primary" />}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 ml-0.5">
                        <Type className="w-3 h-3 opacity-70" />
                        {t('save_session.name')} <span className="text-destructive/80">*</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('save_session.name_placeholder')}
                        className="w-full px-3 py-2 bg-muted/30 border border-border/60 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/30 font-medium"
                        autoFocus
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 ml-0.5">
                        <AlignLeft className="w-3 h-3 opacity-70" />
                        {t('save_session.desc')}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('save_session.desc_placeholder')}
                        rows={3}
                        className="w-full px-3 py-2 bg-muted/30 border border-border/60 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all resize-none placeholder:text-muted-foreground/30"
                    />
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-border/40 mt-6 -mx-4 px-4 pt-4 bg-muted/5">
                    <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => setSaveSessionModalOpen(false)}
                    >
                        {t('common.cancel')}
                    </Button>
                    <Button
                        size="sm"
                        type="submit"
                        disabled={!name.trim() || loading}
                        className="min-w-[80px]"
                    >
                        {loading ? (
                            <>
                                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {t('save_session.saving')}
                            </>
                        ) : (
                            <>
                                <Save className="w-3.5 h-3.5" />
                                {t('save_session.save_btn')}
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
