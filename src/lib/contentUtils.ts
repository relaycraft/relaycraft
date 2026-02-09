export type ContentType =
	| "image"
	| "json"
	| "html"
	| "javascript"
	| "css"
	| "xml"
	| "text"
	| "binary"
	| "unknown";

export function detectContentType(
	headers: Record<string, string> | null,
	content: string | null,
): ContentType {
	if (!headers) return "text";

	// Case-insensitive header lookup
	const contentTypeHeader = Object.keys(headers).find(
		(key) => key.toLowerCase() === "content-type",
	);
	const contentTypeValue = contentTypeHeader
		? headers[contentTypeHeader].toLowerCase()
		: "";

	if (contentTypeValue.includes("image/")) return "image";
	if (contentTypeValue.includes("application/json")) return "json";
	if (contentTypeValue.includes("text/html")) return "html";
	if (
		contentTypeValue.includes("text/javascript") ||
		contentTypeValue.includes("application/javascript")
	)
		return "javascript";
	if (contentTypeValue.includes("text/css")) return "css";
	if (
		contentTypeValue.includes("text/xml") ||
		contentTypeValue.includes("application/xml")
	)
		return "xml";

	// Check for binary content if content-type is generic or missing
	// Simple heuristic: check for null bytes or extensive non-printable characters in the first few bytes if available
	// For now, relies mainly on Content-Type, but could be enhanced.
	if (
		contentTypeValue.includes("application/octet-stream") ||
		contentTypeValue.includes("application/zip") ||
		contentTypeValue.includes("application/pdf") ||
		contentTypeValue.includes("font/") ||
		contentTypeValue.includes("audio/") ||
		contentTypeValue.includes("video/")
	) {
		return "binary";
	}

	// Heuristics based on content if available and type is unknown/text
	if (content) {
		const trimmed = content.trim();
		if (
			(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
			(trimmed.startsWith("[") && trimmed.endsWith("]"))
		) {
			try {
				JSON.parse(trimmed);
				return "json";
			} catch (e) {
				// Not JSON
			}
		}
		if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
			if (trimmed.toLowerCase().includes("<html")) return "html";
			if (trimmed.toLowerCase().includes("<?xml")) return "xml";
		}
	}

	return "text";
}

export function formatJson(content: string): string {
	try {
		const parsed = JSON.parse(content);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return content;
	}
}

export function formatXml(xml: string): string {
	// Basic XML formatter
	let formatted = "";
	const reg = /(>)(<)(\/*)/g;
	xml = xml.replace(reg, "$1\r\n$2$3");
	let pad = 0;

	xml.split("\r\n").forEach((node) => {
		let indent = 0;
		if (node.match(/.+<\/\w[^>]*>$/)) {
			indent = 0;
		} else if (node.match(/^<\/\w/)) {
			if (pad !== 0) {
				pad -= 1;
			}
		} else if (node.match(/^<\w[^>]*[^/]>.*$/)) {
			indent = 1;
		} else {
			indent = 0;
		}

		let padding = "";
		for (let i = 0; i < pad; i++) {
			padding += "  ";
		}

		formatted += padding + node + "\r\n";
		pad += indent;
	});

	return formatted;
}

export function getExtensionFromHeaders(
	headers: Record<string, string> | null,
	contentType: ContentType,
): string {
	if (!headers) return "txt";

	const contentTypeHeader = Object.keys(headers).find(
		(key) => key.toLowerCase() === "content-type",
	);
	const mime = contentTypeHeader
		? headers[contentTypeHeader].toLowerCase()
		: "";

	if (mime.includes("application/json")) return "json";
	if (mime.includes("text/html")) return "html";
	if (
		mime.includes("text/javascript") ||
		mime.includes("application/javascript")
	)
		return "js";
	if (mime.includes("text/css")) return "css";
	if (mime.includes("text/xml") || mime.includes("application/xml"))
		return "xml";
	if (mime.includes("image/png")) return "png";
	if (mime.includes("image/jpeg")) return "jpg";
	if (mime.includes("image/gif")) return "gif";
	if (mime.includes("image/webp")) return "webp";
	if (mime.includes("image/svg")) return "svg";
	if (mime.includes("application/pdf")) return "pdf";
	if (mime.includes("application/zip")) return "zip";
	if (mime.includes("text/plain")) return "txt";

	// Fallback to detected generic type
	switch (contentType) {
		case "json":
			return "json";
		case "html":
			return "html";
		case "xml":
			return "xml";
		case "javascript":
			return "js";
		case "css":
			return "css";
		case "image":
			return "png"; // default image
		case "binary":
			return "bin";
		default:
			return "txt";
	}
}
