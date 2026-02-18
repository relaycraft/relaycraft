import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Create a custom tailwind-merge instance that recognizes our custom font-size classes
const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-micro", "text-tiny", "text-ui"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}

export function formatProtocol(protocol?: string): string {
  if (!protocol) return "";
  const p = protocol.toUpperCase();
  if (p.includes("HTTP/2.0") || p === "H2") return "h2";
  if (p.includes("HTTP/3.0") || p === "H3") return "h3";
  if (p.includes("HTTP/1.1")) return "http/1.1";
  if (p.includes("HTTP/1.0")) return "http/1.0";
  return protocol.toLowerCase();
}

export function getProtocolColor(protocol?: string): string {
  const p = formatProtocol(protocol);
  if (p === "h2")
    return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-900";
  if (p === "h3")
    return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-900";
  if (p.includes("ws"))
    return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900";
  return "bg-muted text-muted-foreground border-border/50";
}

/**
 * Get text color class for HTTP status codes
 */
export function getHttpStatusCodeClass(status: number | null): string {
  if (status === 0 || status === null)
    return "text-muted-foreground/60 bg-muted/5 border-border/20";
  if (status < 200) return "text-muted-foreground bg-muted/10 border-border/30";
  if (status < 300)
    return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  if (status < 400) return "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (status < 500) return "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/20";
  return "text-red-700 dark:text-red-400 bg-red-600/10 border-red-600/20";
}

/**
 * Get full Tailwind class string for HTTP method badges
 */
export function getHttpMethodBadgeClass(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-method-get/10 text-method-get border-method-get/20";
    case "POST":
      return "bg-method-post/10 text-method-post border-method-post/20";
    case "PUT":
      return "bg-method-put/10 text-method-put border-method-put/20";
    case "DELETE":
      return "bg-method-delete/10 text-method-delete border-method-delete/20";
    default:
      return "bg-muted text-muted-foreground border-border/20";
  }
}

/**
 * Get color/weight class for transaction duration
 */
export function getDurationBadgeClass(ms: number | null): string {
  if (!ms) return "";
  if (ms < 400) return "bg-muted/10 text-muted-foreground/50";
  if (ms < 1000) return "bg-warning/5 text-warning/80";
  if (ms < 3000) return "bg-orange-500/10 text-orange-500";
  return "bg-error/10 text-error animate-pulse font-bold";
}

/**
 * Get background color class for rule dots/indicators
 */
export function getRuleTypeDotClass(type: string, status?: string): string {
  if (status === "file_not_found") return "bg-error";
  switch (type) {
    case "script":
      return "bg-rule-script";
    case "breakpoint":
      return "bg-rule-breakpoint";
    case "rewrite_body":
      return "bg-rule-rewrite-body";
    case "map_local":
      return "bg-rule-map-local";
    case "map_remote":
      return "bg-rule-map-remote";
    case "rewrite_header":
      return "bg-rule-rewrite-header";
    case "throttle":
      return "bg-rule-throttle";
    case "block_request":
      return "bg-rule-block";
    default:
      return "bg-muted-foreground/40";
  }
}

/**
 * Get full badge class for rule type labels
 */
export function getRuleTypeBadgeClass(type: string, status?: string): string {
  const dotClass = getRuleTypeDotClass(type, status);
  const colorName = dotClass.replace("bg-", "");
  return `text-${colorName} bg-${colorName}/10 border border-${colorName}/20`;
}

/**
 * Generates a unique name given a base name and a list of existing names.
 * Example: if "Untitled Script.py" exists, returns "Untitled Script 1.py"
 */
export function getUniqueName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  const extensionMatch = baseName.match(/\.[^.]+$/);
  const extension = extensionMatch ? extensionMatch[0] : "";
  const nameWithoutExt = extensionMatch ? baseName.slice(0, -extension.length) : baseName;

  let counter = 1;
  while (true) {
    const newName = `${nameWithoutExt} ${counter}${extension}`;
    if (!existingNames.includes(newName)) {
      return newName;
    }
    counter++;
  }
}
