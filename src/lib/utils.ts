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
