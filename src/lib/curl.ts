import type { Flow } from "../types";

export function generateCurlCommand(flow: Flow): string {
  let command = `curl -X ${flow.request.method} '${flow.request.url}'`;

  // Add headers
  if (flow.request.headers) {
    flow.request.headers.forEach((header) => {
      if (header.name.toLowerCase() !== "content-length" && header.name.toLowerCase() !== "host") {
        command += ` \\\n  -H '${header.name}: ${header.value.replace(/'/g, "'\\''")}'`;
      }
    });
  }

  // Add body
  if (flow.request.postData?.text) {
    // Escaping logic is complex, for simplicity we trust the content or basic escape
    // Ideally we check content-type
    // For now basic implementation
    command += ` \\\n  -d '${flow.request.postData.text.replace(/'/g, "'\\''")}'`;
  }

  return command;
}
