export interface ParsedCurl {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string | null;
}

export function parseCurl(curlCommand: string): ParsedCurl | null {
	if (!curlCommand || !curlCommand.trim().startsWith("curl")) return null;

	const result: ParsedCurl = {
		method: "GET", // Default
		url: "",
		headers: {},
		body: null,
	};

	// Very basic shell-like argument parser
	const args: string[] = [];
	let current = "";
	let inQuotes = false;
	let quoteChar = "";

	for (let i = 0; i < curlCommand.length; i++) {
		const char = curlCommand[i];
		if (char === '"' || char === "'") {
			if (!inQuotes) {
				inQuotes = true;
				quoteChar = char;
			} else if (char === quoteChar) {
				inQuotes = false;
			} else {
				current += char;
			}
		} else if (char === " " && !inQuotes) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else if (char === "\\" && i + 1 < curlCommand.length) {
			// Handle escaped characters (mostly spaces and quotes inside quotes)
			current += curlCommand[++i];
		} else {
			current += char;
		}
	}
	if (current) args.push(current);

	// Skip the first 'curl' arg
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1] || "";

		if (arg === "-X" || arg === "--request") {
			result.method = next.toUpperCase();
			i++;
		} else if (arg === "-H" || arg === "--header") {
			const separatorIndex = next.indexOf(":");
			if (separatorIndex > 0) {
				const key = next.substring(0, separatorIndex).trim();
				const value = next.substring(separatorIndex + 1).trim();
				result.headers[key] = value;
			}
			i++;
		} else if (
			arg === "-d" ||
			arg === "--data" ||
			arg === "--data-raw" ||
			arg === "--data-binary"
		) {
			result.body = next;
			if (result.method === "GET") result.method = "POST"; // Auto-switch if data is present
			i++;
		} else if (arg.startsWith("http")) {
			result.url = arg;
		}
	}

	// fallback for URL if not starting with http (happens if it's just after curl)
	if (!result.url && args[1] && !args[1].startsWith("-")) {
		result.url = args[1];
	}

	return result.url ? result : null;
}
