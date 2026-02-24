import i18n from "../../i18n";
import { useUIStore } from "../../stores/uiStore";

/**
 * Utility to get language information and terminology for AI prompts.
 * This ensures that the AI responds in the correct language and uses
 * terms consistent with the UI, even when using "small languages"
 * provided by plugins.
 */
export function getAILanguageInfo() {
  const langCode = i18n.language || "en";
  const availableLanguages = useUIStore.getState().availableLanguages;

  // Find the label for the current language (e.g., "English", "简体中文", "Français")
  const langEntry = availableLanguages.find((l) => l.value === langCode);
  let langName = langEntry?.label || langCode;

  // Polish language name for AI
  if (langCode === "zh") langName = "Simplified Chinese";
  if (langCode === "en") langName = "English";

  // Get terminology from i18n to ensure consistent terms (Rules, Scripts, etc.)
  const terminology = [
    i18n.t("common.terminology.rules"),
    i18n.t("common.terminology.scripts"),
    i18n.t("common.terminology.traffic"),
    i18n.t("common.terminology.proxy"),
    i18n.t("common.terminology.map_local"),
    i18n.t("common.terminology.map_remote"),
    i18n.t("common.terminology.rewrite_header"),
    i18n.t("common.terminology.rewrite_body"),
    i18n.t("common.terminology.throttle"),
    i18n.t("common.terminology.block_request"),
  ]
    .filter(Boolean)
    .join(", ");

  return {
    code: langCode,
    name: langName, // Human readable name for AI
    terminology,
    flow: {
      summary: i18n.t("flow.analysis.summary_title", {
        defaultValue: langCode === "zh" ? "摘要" : "Summary",
      }),
      diagnostics: i18n.t("flow.analysis.diagnostics_title", {
        defaultValue: langCode === "zh" ? "诊断分析" : "Diagnostics",
      }),
      optimization: i18n.t("flow.analysis.optimization_title", {
        defaultValue: langCode === "zh" ? "优化建议" : "Optimization Suggestions",
      }),
    },
  };
}
