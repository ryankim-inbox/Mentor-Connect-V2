import assert from "node:assert/strict";
import test from "node:test";
import { dateOfBirthError, signupPasswordError } from "../src/lib/signup-validation";

test("new signup password rules count Unicode characters and UTF-8 bytes independently", () => {
  for (const password of [
    "", "Abcdefghij!", "lowercase123!", "Uppercase1234", "Äbcdefghijk!",
    "Abcdefghijk😀", "Abcdefghijk ", "A!" + "a".repeat(71),
    "A!" + "😀".repeat(9), "A!" + "😀".repeat(17) + "界", "A!abcdefghij\ud800",
  ]) {
    assert.ok(signupPasswordError(password));
  }
  for (const password of [
    "Password123!", "A!" + "😀".repeat(10), "A!" + "a".repeat(70),
    "A!" + "😀".repeat(17) + "aa", "A!" + "界".repeat(23) + "a",
  ]) {
    assert.equal(signupPasswordError(password), "");
  }
});

test("all 32 ASCII punctuation characters qualify as a special character", () => {
  for (const punctuation of "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~") {
    assert.equal(signupPasswordError("Abcdefghijk" + punctuation), "");
  }
});

test("birth dates must be exact real calendar dates and no later than today in UTC", () => {
  const now = new Date("2026-10-23T23:59:59Z");
  for (const value of [
    "", "2008-2-29", "20080229", "2008-W09-5", "2008-02-29T00:00:00Z",
    " 2008-02-29", "2008-02-29\n", "2009-02-29", "1900-02-29", "2008-04-31",
    "0000-01-01", "２００８-０２-２９", "2026-10-24",
  ]) {
    assert.ok(dateOfBirthError(value, now));
  }
  for (const value of ["0001-01-01", "2000-02-29", "2008-02-29", "2026-10-23"]) {
    assert.equal(dateOfBirthError(value, now), "");
  }
});
