import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  if (status === 0) return "text-red-500/50 italic font-medium";
  if (status === null) return "text-muted-foreground/60 font-bold";
  if (status < 300) return "text-success";
  if (status < 400) return "text-warning";
  return "text-error";
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
