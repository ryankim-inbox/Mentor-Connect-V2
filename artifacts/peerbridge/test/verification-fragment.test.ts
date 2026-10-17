import assert from "node:assert/strict";
import test from "node:test";

test("fragment ownership secrets are replaced, scrubbed and cleared in document memory", async () => {
  const target = new EventTarget();
  let url = new URL(
    "https://local.invalid/verify-email#token=" + "a".repeat(43),
  );
  const browser = {
    get location() {
      return url;
    },
    history: {
      state: {},
      replaceState(_state: unknown, _title: string, value: string) {
        url = new URL(value, url);
      },
    },
    addEventListener: target.addEventListener.bind(target),
  };
  Object.defineProperty(globalThis, "window", {
    value: browser,
    configurable: true,
  });
  try {
    const { verificationFragment } =
      await import("../src/lib/verification-fragment");
    assert.equal(url.hash, "");
    assert.equal(verificationFragment.snapshot(), "a".repeat(43));
    const oldVersion = verificationFragment.version();
    let notifications = 0;
    const unsubscribe = verificationFragment.subscribe(() => notifications++);
    url.hash = "token=" + "b".repeat(43);
    target.dispatchEvent(new Event("hashchange"));
    assert.equal(url.hash, "");
    assert.equal(verificationFragment.snapshot(), "b".repeat(43));
    assert.equal(notifications, 1);
    assert.equal(verificationFragment.clear(oldVersion), false);
    assert.equal(verificationFragment.snapshot(), "b".repeat(43));
    const replacedVersion = verificationFragment.version();
    url.hash = "token=" + "b".repeat(43);
    target.dispatchEvent(new Event("hashchange"));
    assert.equal(verificationFragment.clear(replacedVersion), false);
    assert.equal(verificationFragment.snapshot(), "b".repeat(43));
    url.hash = "token=invalid";
    target.dispatchEvent(new Event("hashchange"));
    assert.equal(verificationFragment.snapshot(), "");
    assert.equal(url.hash, "");
    url.hash = "token=" + "c".repeat(43);
    target.dispatchEvent(new Event("hashchange"));
    verificationFragment.clear();
    assert.equal(verificationFragment.snapshot(), "");
    unsubscribe();
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});
