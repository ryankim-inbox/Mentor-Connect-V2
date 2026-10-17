import type { InputTransformerFn } from "orval";

// OpenAPI maxLength counts code points, but Zod 3's string.max counts UTF-16
// units. Preserve the standard contract for other clients and translate only
// explicitly annotated character limits for Zod generation. Orval emits the
// Unicode flag for patterns containing a Unicode property escape.
export const codePointTransformer: InputTransformerFn = (config) => {
  const transformed = structuredClone(config);
  transformed.info.title = "Api";
  function visit(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    const schema = value as Record<string, unknown>;
    if (schema["x-length-unit"] === "unicode-code-points") {
      const maximum = schema.maxLength;
      if (
        typeof maximum !== "number" ||
        !Number.isSafeInteger(maximum) ||
        maximum < 0 ||
        schema.pattern !== undefined
      ) {
        throw new Error(
          "Annotated code-point limits require a finite maxLength and no existing pattern",
        );
      }
      delete schema.maxLength;
      // The final negative lookahead enforces the true end of input, including
      // a final newline (JavaScript's $ alone also matches before that newline).
      schema.pattern = `^(?:\\p{Any}){0,${maximum}}(?!\\p{Any})`;
    }
    for (const child of Object.values(schema)) visit(child);
  }
  visit(transformed);
  return transformed;
};
