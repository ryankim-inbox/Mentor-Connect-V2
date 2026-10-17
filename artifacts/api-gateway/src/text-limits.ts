// Python len(str) and JSON Schema maxLength count Unicode code points.
// UTF-8 byte limits use Buffer.byteLength separately.
export function hasAtMostCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _point of value) {
    if (++count > maximum) return false;
  }
  return true;
}
