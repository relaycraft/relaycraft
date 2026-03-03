import type { RuleType } from "../types/rules";

export interface RuleTypeTheme {
  text: string;
  bg: string;
  border: string;
}

const RULE_TYPE_THEME_MAP: Record<RuleType, RuleTypeTheme> = {
  rewrite_body: {
    text: "text-rule-rewrite-body",
    bg: "bg-rule-rewrite-body-soft",
    border: "border-rule-rewrite-body-soft",
  },
  rewrite_header: {
    text: "text-rule-rewrite-header",
    bg: "bg-rule-rewrite-header-soft",
    border: "border-rule-rewrite-header-soft",
  },
  map_local: {
    text: "text-rule-map-local",
    bg: "bg-rule-map-local-soft",
    border: "border-rule-map-local-soft",
  },
  map_remote: {
    text: "text-rule-map-remote",
    bg: "bg-rule-map-remote-soft",
    border: "border-rule-map-remote-soft",
  },
  throttle: {
    text: "text-rule-throttle",
    bg: "bg-rule-throttle-soft",
    border: "border-rule-throttle-soft",
  },
  block_request: {
    text: "text-rule-block",
    bg: "bg-rule-block-soft",
    border: "border-rule-block-soft",
  },
};

export function getRuleTypeTheme(type: RuleType): RuleTypeTheme {
  return RULE_TYPE_THEME_MAP[type];
}

type RuleIndicatorType = RuleType | "script" | "breakpoint";

const RULE_TYPE_INDICATOR_BG_MAP: Record<RuleIndicatorType, string> = {
  script: "bg-rule-script",
  breakpoint: "bg-rule-breakpoint",
  rewrite_body: "bg-rule-rewrite-body",
  map_local: "bg-rule-map-local",
  map_remote: "bg-rule-map-remote",
  rewrite_header: "bg-rule-rewrite-header",
  throttle: "bg-rule-throttle",
  block_request: "bg-rule-block",
};

function isRuleIndicatorType(type: string): type is RuleIndicatorType {
  return type in RULE_TYPE_INDICATOR_BG_MAP;
}

export function getRuleTypeDotClass(type: string, status?: string): string {
  if (status === "file_not_found") return "bg-error";
  if (isRuleIndicatorType(type)) {
    return RULE_TYPE_INDICATOR_BG_MAP[type];
  }
  return "bg-muted-foreground/40";
}

export function getRuleTypeBadgeClass(type: string, status?: string): string {
  if (status === "file_not_found") {
    return "text-error bg-error/10 border border-error/20";
  }

  if (isRuleIndicatorType(type)) {
    const colorName = RULE_TYPE_INDICATOR_BG_MAP[type].replace("bg-", "");
    return `text-${colorName} bg-${colorName}-soft border border-${colorName}-soft`;
  }

  return "text-muted-foreground bg-muted/10 border border-border/20";
}
