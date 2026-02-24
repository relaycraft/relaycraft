import { useTranslation } from "react-i18next";
import { useRuleStore } from "../stores/ruleStore";
import { type TabType, useUIStore } from "../stores/uiStore";

export function useNavigate() {
  const { t } = useTranslation();
  const { activeTab, setActiveTab, showConfirm } = useUIStore();
  const { isEditorDirty, clearActiveRule } = useRuleStore();

  const navigate = (targetTab: TabType) => {
    // If we're already on the target tab, do nothing
    if (activeTab === targetTab) return;

    const performNavigation = () => {
      // If we're leaving the rules tab, clean up the editor state
      if (activeTab === "rules") {
        clearActiveRule();
      }
      setActiveTab(targetTab);
    };

    // Only guard if leaving the rules tab with unsaved changes
    if (activeTab === "rules" && isEditorDirty) {
      showConfirm({
        title: t("rules.alerts.discard_title"),
        message: t("rules.alerts.discard_msg"),
        variant: "warning",
        onConfirm: performNavigation,
      });
    } else {
      performNavigation();
    }
  };

  return { navigate };
}
