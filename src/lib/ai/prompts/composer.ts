export const COMPOSER_SCHEMA_DEFINITION = `
### Composer Request Schema:
The params for "GENERATE_REQUEST" MUST follow this structure.

**Guidelines:**
1. **URL**: ALWAYS provide a full URL when enough information is available. If host/scheme is missing, keep "url" as an empty string and ask for completion in "explanation" instead of inventing a placeholder target.
2. **Method**: Default to "GET" unless "POST", "PUT", etc., is mentioned.
3. **Body Type**: 
   - Use "raw" for JSON or plain text.
   - Use "x-www-form-urlencoded" for form data.
   - Use "none" for GET requests.
4. **Headers**: ALWAYS include 'Content-Type' if there is a body. Add common headers like 'Accept: application/json' if appropriate.

**Schema:**
\`\`\`typescript
{
  "method": "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  "url": string,
  "headers": Array<{ key: string, value: string }>,
  "body": string,
  "bodyType": "none" | "raw" | "x-www-form-urlencoded"
}
\`\`\`
`;
