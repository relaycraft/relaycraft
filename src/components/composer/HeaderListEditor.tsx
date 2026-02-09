import { Plus, Trash2, CheckCircle2, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderItem {
    key: string;
    value: string;
    enabled: boolean;
}

interface HeaderListEditorProps {
    headers: HeaderItem[];
    onChange: (headers: HeaderItem[]) => void;
}

export function HeaderListEditor({ headers, onChange }: HeaderListEditorProps) {
    const { t } = useTranslation();

    const addItem = () => {
        onChange([...headers, { key: '', value: '', enabled: true }]);
    };

    const updateItem = (index: number, field: keyof HeaderItem, value: any) => {
        const newItems = [...headers];
        newItems[index] = { ...newItems[index], [field]: value };
        onChange(newItems);
    };

    const removeItem = (index: number) => {
        onChange(headers.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-extrabold text-muted-foreground uppercase tracking-widest">{t('common.headers')}</label>
                <button
                    onClick={addItem}
                    className="text-[10px] flex items-center gap-1.5 text-primary hover:bg-primary/5 px-2 py-1 rounded-md transition-all font-bold uppercase tracking-wider"
                >
                    <Plus className="w-3 h-3" />
                    {t('composer.headers_list.add')}
                </button>
            </div>

            <div className="space-y-1.5">
                {headers.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 group">
                        <button
                            onClick={() => updateItem(index, 'enabled', !item.enabled)}
                            className={`p-1 rounded-md transition-colors ${item.enabled ? 'text-primary' : 'text-muted-foreground/30'}`}
                        >
                            {item.enabled ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                        </button>
                        <input
                            type="text"
                            value={item.key}
                            onChange={(e) => updateItem(index, 'key', e.target.value)}
                            placeholder={t('composer.headers_list.key')}
                            className={`flex-1 px-3 py-1.5 bg-muted/20 border border-border/40 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all ${!item.enabled && 'opacity-50 grayscale'}`}
                        />
                        <input
                            type="text"
                            value={item.value}
                            onChange={(e) => updateItem(index, 'value', e.target.value)}
                            placeholder={t('composer.headers_list.value')}
                            className={`flex-[1.5] px-3 py-1.5 bg-muted/20 border border-border/40 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all ${!item.enabled && 'opacity-50 grayscale'}`}
                        />
                        <button
                            onClick={() => removeItem(index)}
                            className="p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
                {headers.length === 0 && (
                    <div className="text-[11px] text-muted-foreground border border-dashed border-border/60 rounded-xl py-4 text-center bg-muted/5 font-medium">
                        {t('composer.headers_list.empty')}
                    </div>
                )}
            </div>
        </div>
    );
}
