/**
 * Utility functions for processing AI-generated content.
 */

/**
 * Removes <think>...</think> blocks from AI output.
 * Handles both complete and unclosed tags (for streaming).
 */
export function stripThoughts(content: string): string {
	if (!content) return "";

	// Remove complete tags
	let result = content.replace(/<think>[\s\S]*?<\/think>/g, "");

	// Remove unclosed tags at the end (useful for streaming)
	result = result.replace(/<think>[\s\S]*$/g, "");

	return result.trim();
}

/**
 * Cleans AI result for use in input fields.
 * Strips thoughts and removes markdown code block markers.
 */
export function cleanAIResult(content: string): string {
	const withoutThoughts = stripThoughts(content);

	return withoutThoughts
		.replace(/^```[\w]*\n/, "") // Remove opening ```json or ```regex
		.replace(/\n```$/, "") // Remove closing ```
		.replace(/^`+|`+$/g, "") // Remove inline backticks
		.replace(/^regex\n/i, "") // Remove common "regex" header
		.replace(/^(filter|query|search|response|result|answer|output):\s*/i, "") // Remove common labels safely
		.trim();
}
