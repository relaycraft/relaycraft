import { AppWindow, Code2, Globe, HelpCircle, type LucideIcon, Smartphone } from "lucide-react";

export interface AppIconDescriptor {
  Icon: LucideIcon;
  toneClass: string;
}

const UNKNOWN_ICON: AppIconDescriptor = {
  Icon: HelpCircle,
  toneClass: "text-muted-foreground/40",
};

export function getAppIcon(appName: string | undefined): AppIconDescriptor {
  if (!appName) return UNKNOWN_ICON;
  const lower = appName.toLowerCase();
  if (lower.endsWith(".safari") || lower.endsWith(".firefox") || lower.endsWith(".edge")) {
    return { Icon: Globe, toneClass: "text-sky-500/80" };
  }
  if (lower.endsWith(".chrome") || lower.endsWith(".crios") || lower.endsWith(".fxios")) {
    return { Icon: Globe, toneClass: "text-amber-500/80" };
  }
  if (lower.endsWith(".okhttp") || lower.endsWith(".cronet") || lower.endsWith(".cfnetwork")) {
    return { Icon: Code2, toneClass: "text-indigo-500/80" };
  }
  if (lower.endsWith(".dart") || lower.endsWith(".flutter")) {
    return { Icon: Code2, toneClass: "text-sky-600/80" };
  }
  if (
    lower.endsWith(".curl") ||
    lower.endsWith(".wget") ||
    lower.endsWith(".nodejs") ||
    lower.endsWith(".python") ||
    lower.endsWith(".go") ||
    lower.endsWith(".java")
  ) {
    return { Icon: AppWindow, toneClass: "text-slate-500/80" };
  }
  if (lower.endsWith(".app")) {
    return { Icon: Smartphone, toneClass: "text-violet-500/80" };
  }
  if (lower.endsWith(".unknown")) {
    return UNKNOWN_ICON;
  }
  return UNKNOWN_ICON;
}
