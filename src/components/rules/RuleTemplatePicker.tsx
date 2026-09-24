import { LayoutTemplate, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildTemplateDraft, type RuleTemplateId } from "../../lib/rules/ruleTemplates";
import { useRuleStore } from "../../stores/ruleStore";
import { useUIStore } from "../../stores/uiStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";

/**
 * Minimal curated template picker next to "New Rule".
 *
 * Choosing a template goes through the same dirty-editor confirmation as
 * creating a blank rule, then loads a disabled draft into the editor.
 */
export function RuleTemplatePicker() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Static per-id mapping so check:i18n sees literal keys.
  const templates: Array<{ id: RuleTemplateId; name: string; desc: string }> = [
    {
      id: "block_request",
      name: t("rules.templates.block_request.name"),
      desc: t("rules.templates.block_request.desc"),
    },
    {
      id: "map_local_json",
      name: t("rules.templates.map_local_json.name"),
      desc: t("rules.templates.map_local_json.desc"),
    },
  ];

  const handleChoose = (template: (typeof templates)[number]) => {
    const apply = () => {
      const { selectRule, setDraftRule } = useRuleStore.getState();
      selectRule(null);
      setDraftRule(buildTemplateDraft(template.id, template.name));
      setOpen(false);
    };

    const { isEditorDirty } = useRuleStore.getState();
    if (isEditorDirty) {
      // Same confirmation contract as the "New Rule" button.
      useUIStore.getState().showConfirm({
        title: t("rules.alerts.discard_title"),
        message: t("rules.alerts.discard_msg"),
        variant: "warning",
        onConfirm: apply,
      });
    } else {
      apply();
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <LayoutTemplate className="w-3.5 h-3.5" />
        {t("rules.templates.btn")}
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t("rules.templates.title")}
        icon={<LayoutTemplate className="w-4 h-4 text-primary" />}
      >
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{t("rules.templates.desc")}</p>

          <div className="space-y-2">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => handleChoose(template)}
                className="w-full text-left p-3 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 hover:border-primary/30 transition-colors"
              >
                <div className="text-sm font-medium text-foreground">{template.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{template.desc}</div>
              </button>
            ))}
          </div>

          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            {t("rules.templates.warning")}
          </p>
        </div>
      </Modal>
    </>
  );
}
