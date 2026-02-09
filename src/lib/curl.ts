import type { Flow } from "../types";

export function generateCurlCommand(flow: Flow): string {
	let command = `curl -X ${flow.method} '${flow.url}'`;

	// Add headers
	if (flow.requestHeaders) {
		Object.entries(flow.requestHeaders).forEach(([key, value]) => {
			if (
				key.toLowerCase() !== "content-length" &&
				key.toLowerCase() !== "host"
			) {
				// Skip content-length and host usually
				// Handle multiple values if needed, typically array or string
				if (Array.isArray(value)) {
					value.forEach(
						(v) =>
							(command += ` \\\n  -H '${key}: ${v.replace(/'/g, "'\\''")}'`),
					);
				} else {
					command += ` \\\n  -H '${key}: ${value.replace(/'/g, "'\\''")}'`;
				}
			}
		});
	}

	// Add body
	if (flow.requestBody) {
		// Escaping logic is complex, for simplicity we trust the content or basic escape
		// Ideally we check content-type
		// For now basic implementation
		command += ` \\\n  -d '${flow.requestBody.replace(/'/g, "'\\''")}'`;
	}

	return command;
}
