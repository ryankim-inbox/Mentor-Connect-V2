// Names trim the union of Python whitespace and JavaScript trim whitespace.
export function trimDisplayName(value: string): string {
  return value.replace(
    /^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g,
    "",
  );
}
