import { useTranslation } from 'react-i18next';
import { Ban } from 'lucide-react';

export function ActionBlock() {
    const { t } = useTranslation();

    return (
        <div className="p-8 bg-rose-500/5 rounded-xl border border-rose-500/20 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-1">
                <Ban className="w-6 h-6" />
            </div>
            <div>
                <h4 className="text-sm font-semibold text-foreground mb-1">
                    {t('rule_editor.core.types.block_label')}
                </h4>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                    {t('rule_editor.core.types.block_desc')}
                </p>
            </div>
        </div>
    );
}