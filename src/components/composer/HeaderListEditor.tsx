import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../common/Button";

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
    onChange([...headers, { key: "", value: "", enabled: true }]);
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
        <label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wider">
          {t("common.headers")}
        </label>
        <Button
          type="button"
          onClick={addItem}
          variant="ghost"
          size="xs"
          className="text-muted-foreground/80 hover:text-primary hover:bg-primary/5 px-2 rounded-md font-medium text-xs h-7"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          {t("composer.headers_list.add")}
        </Button>
      </div>

      <div className="space-y-1.5">
        {headers.map((item, index) => (
          <div key={index} className="flex items-center gap-1.5 group">
            <button
              type="button"
              onClick={() => updateItem(index, "enabled", !item.enabled)}
              className={`p-1.5 rounded-lg transition-all interactive-pop ${item.enabled ? "text-primary hover:bg-primary/10" : "text-muted-foreground/30 hover:bg-muted"}`}
            >
              {item.enabled ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            </button>
            <div
              className={`flex-1 flex items-center bg-muted/20 border border-border/40 rounded-xl overflow-hidden transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 ${!item.enabled && "opacity-50 grayscale"}`}
            >
              <input
                type="text"
                value={item.key}
                onChange={(e) => updateItem(index, "key", e.target.value)}
                placeholder={t("composer.headers_list.key")}
                className="w-1/3 px-3 py-1.5 bg-transparent text-tiny font-mono focus:outline-none border-r border-border/20"
              />
              <input
                type="text"
                value={item.value}
                onChange={(e) => updateItem(index, "value", e.target.value)}
                placeholder={t("composer.headers_list.value")}
                className="flex-1 px-3 py-1.5 bg-transparent text-tiny font-mono focus:outline-none placeholder:text-muted-foreground/40"
              />
            </div>
            <button
              onClick={() => removeItem(index)}
              className="p-1.5 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 interactive-pop"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {headers.length === 0 && (
          <div className="text-ui text-muted-foreground border border-dashed border-border/60 rounded-xl py-4 text-center bg-muted/5 font-medium">
            {t("composer.headers_list.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
