import { AppWindow, Code2, HelpCircle, Smartphone, Terminal } from "lucide-react";
import type { ComponentType } from "react";
import {
  ChromeBrandIcon,
  EdgeBrandIcon,
  FirefoxBrandIcon,
  SafariBrandIcon,
} from "../components/icons/browserBrandIcons";

type AppIconComponent = ComponentType<{ className?: string }>;

export interface AppIconDescriptor {
  Icon: AppIconComponent;
  /** Lucide tint; leave empty for multi-color brand marks. */
  toneClass: string;
  /** Stable id for tests / debugging. */
  kind: string;
}

const UNKNOWN_ICON: AppIconDescriptor = {
  Icon: HelpCircle,
  toneClass: "text-muted-foreground/40",
  kind: "unknown",
};

/** Strip legacy "Platform · App" prefix from stored display names. */
export function shortAppLabel(appDisplayName: string | undefined): string {
  if (!appDisplayName) return "";
  const parts = appDisplayName
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || appDisplayName;
}

function processLooksLikeApp(processName: string, appLabel: string, appName?: string): boolean {
  const process = processName.toLowerCase();
  const label = appLabel.toLowerCase();
  if (label && process.includes(label)) return true;

  const key = (appName || "").toLowerCase();
  if (key.includes(".chrome") && (process.includes("chrome") || process.includes("chromium"))) {
    return true;
  }
  if (key.includes(".safari") && process.includes("safari")) return true;
  if (
    key.includes(".firefox") &&
    (process.includes("firefox") || process.includes("plugin-container"))
  ) {
    return true;
  }
  if (key.includes(".edge") && process.includes("edge")) return true;
  return false;
}

/** Compact tooltip: Chrome · PID 7853 (skip redundant platform / helper / local IP). */
export function formatAppSourceTooltip(input: {
  appDisplayName?: string;
  appName?: string;
  processName?: string | null;
  pid?: number | null;
  clientIp?: string;
  isLocal?: boolean;
}): string {
  const app = shortAppLabel(input.appDisplayName);
  const parts: string[] = [];
  if (app) parts.push(app);

  const processName = input.processName?.trim();
  if (processName && !processLooksLikeApp(processName, app, input.appName)) {
    parts.push(processName);
  }

  if (input.pid != null) {
    parts.push(`PID ${input.pid}`);
  }

  if (!input.isLocal && input.clientIp) {
    parts.push(input.clientIp);
  }

  return parts.join(" · ");
}

export function getAppIcon(appName: string | undefined): AppIconDescriptor {
  if (!appName) return UNKNOWN_ICON;
  const lower = appName.toLowerCase();

  if (lower.endsWith(".chrome") || lower.endsWith(".crios")) {
    return { Icon: ChromeBrandIcon, toneClass: "", kind: "chrome" };
  }
  if (lower.endsWith(".safari")) {
    return { Icon: SafariBrandIcon, toneClass: "", kind: "safari" };
  }
  if (lower.endsWith(".firefox") || lower.endsWith(".fxios")) {
    return { Icon: FirefoxBrandIcon, toneClass: "", kind: "firefox" };
  }
  if (lower.endsWith(".edge")) {
    return { Icon: EdgeBrandIcon, toneClass: "", kind: "edge" };
  }

  if (lower.endsWith(".okhttp") || lower.endsWith(".cronet") || lower.endsWith(".cfnetwork")) {
    return { Icon: Code2, toneClass: "text-indigo-500/80", kind: "http-stack" };
  }
  if (lower.endsWith(".dart") || lower.endsWith(".flutter")) {
    return { Icon: Code2, toneClass: "text-sky-600/80", kind: "dart" };
  }
  if (
    lower.endsWith(".curl") ||
    lower.endsWith(".wget") ||
    lower.endsWith(".nodejs") ||
    lower.endsWith(".python") ||
    lower.endsWith(".go") ||
    lower.endsWith(".java")
  ) {
    return { Icon: Terminal, toneClass: "text-slate-500/80", kind: "cli" };
  }
  if (lower.endsWith(".app")) {
    return { Icon: Smartphone, toneClass: "text-violet-500/80", kind: "mobile-app" };
  }
  if (lower.endsWith(".unknown")) {
    return UNKNOWN_ICON;
  }
  return { Icon: AppWindow, toneClass: "text-muted-foreground/50", kind: "generic" };
}
