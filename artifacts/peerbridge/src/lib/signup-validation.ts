export const SIGNUP_PASSWORD_HELP =
  "Use at least 12 characters, an uppercase letter (A–Z), and an ASCII special character; maximum 72 UTF-8 bytes.";

export function signupPasswordError(value: string): string {
  // Keep these ASCII punctuation ranges in sync with RegisterBody in Python/routers/auth.py.
  if (
    [...value].length < 12 ||
    !/[A-Z]/.test(value) ||
    !/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/.test(value) ||
    /[\uD800-\uDFFF]/u.test(value) ||
    new TextEncoder().encode(value).length > 72
  ) {
    return SIGNUP_PASSWORD_HELP;
  }
  return "";
}

export function dateOfBirthError(value: string, now = new Date()): string {
  const born = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith("0000-") ||
    !Number.isFinite(born.getTime()) ||
    born.toISOString().slice(0, 10) !== value ||
    value > now.toISOString().slice(0, 10)
  ) {
    return "Use a real date of birth in YYYY-MM-DD format, no later than today.";
  }
  return "";
}
