// Ownership secrets live only in this document's memory. Never use a query/mutation cache.
let token = "";
const listeners = new Set<() => void>();
function capture() {
  if (window.location.pathname !== "/verify-email" || !window.location.hash)
    return;
  const candidate =
    new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  token = /^[A-Za-z0-9_-]{43,128}$/.test(candidate) ? candidate : "";
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") {
  capture();
  window.addEventListener("hashchange", capture);
  window.addEventListener("popstate", capture);
}
export const verificationFragment = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => token,
  clear() {
    token = "";
    listeners.forEach((listener) => listener());
  },
};
