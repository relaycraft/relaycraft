import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HeaderOperation } from "../../types/rules";
import { Input } from "../common/Input";
import { Select } from "../common/Select";

interface HeaderEditorProps {
  operations: HeaderOperation[];
  onChange: (operations: HeaderOperation[]) => void;
  label?: string;
}

export function HeaderEditor({ operations, onChange, label }: HeaderEditorProps) {
  const { t } = useTranslation();

  const addOperation = () => {
    onChange([...operations, { operation: "add", key: "", value: "" }]);
  };

  const updateOperation = (index: number, field: keyof HeaderOperation, value: string) => {
    const newOps = [...operations];
    newOps[index] = { ...newOps[index], [field]: value } as HeaderOperation;
    onChange(newOps);
  };

  const removeOperation = (index: number) => {
    onChange(operations.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-bold text-foreground/50 uppercase tracking-widest">
          {label || t("header_editor.title")}
        </span>
      </div>
      <div className="space-y-2">
        {operations.map((op, index) => (
          <div
            key={index}
            className="grid grid-cols-[1.5fr_130px_1fr_auto] gap-2 items-center group"
          >
            <Input
              type="text"
              value={op.key}
              onChange={(e) => updateOperation(index, "key", e.target.value)}
              placeholder="Header Key"
              className="font-mono text-[11px] h-8 placeholder:text-[10px] w-full bg-muted/20 border-border/40 focus:bg-background transition-colors"
            />

            <Select
              value={op.operation}
              onChange={(val) => updateOperation(index, "operation", val)}
              className="h-8 py-1 text-[11px] w-full bg-muted/20 border-border/40"
              containerClassName="w-full"
            >
              <option value="add">{t("header_editor.op_add")}</option>
              <option value="set">{t("header_editor.op_set")}</option>
              <option value="remove">{t("header_editor.op_remove")}</option>
            </Select>

            {op.operation !== "remove" ? (
              <Input
                type="text"
                value={op.value || ""}
                onChange={(e) => updateOperation(index, "value", e.target.value)}
                placeholder="Value"
                className="font-mono text-[11px] h-8 placeholder:text-[10px] w-full bg-muted/20 border-border/40 focus:bg-background transition-colors"
              />
            ) : (
              <div />
            )}

            <button
              onClick={() => removeOperation(index)}
              className="p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          onClick={addOperation}
          className="w-full py-2 flex items-center justify-center gap-1.5 border border-dashed border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all mt-2"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("header_editor.add")}
        </button>
      </div>
    </div>
  );
}
