export const REQUEST_TITLE_LIMIT = 60;
export const requestTitleLength = (value: string) => Array.from(value).length;

// Match Python's Unicode code-point count and whitespace union; retain raw spaces.
export function requestTitleError(value: string): string | null {
  if (
    !value.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g, "") ||
    /[\uD800-\uDFFF]/u.test(value) ||
    requestTitleLength(value) > REQUEST_TITLE_LIMIT
  ) return "Title must contain text and be at most 60 characters, including spaces.";
  return null;
}
