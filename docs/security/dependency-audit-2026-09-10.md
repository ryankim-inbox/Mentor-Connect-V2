# Dependency remediation — 10 September 2026 (America/Los_Angeles)

Full pnpm audit responses are retained in [before](dependency-audit-2026-09-10.before.json)
and [after](dependency-audit-2026-09-10.after.json). The audit changed from 55 findings
(11 critical, 30 high, 12 moderate, 2 low) to zero. These are dependency findings,
not evidence of exploitation. No audit ignore or new release-age exception was added.

Selection used `pnpm view orval version`, `pnpm view orval@8 version`,
`pnpm view drizzle-orm version`, `pnpm view vite@7 version`, `pnpm view yaml version`,
and `pnpm view <package> time --json` for each selected package, alongside the audit's
patched ranges and maintainer releases/advisories. Node 24.21.0 / pnpm 10.33.0 were used.
`minimumReleaseAge: 1440` and existing major families remain in force.

- Orval **8.30.0**, published 7 September 2026, is the latest release eligible for the
  one-day minimum at selection time. The registry's newest **8.31.0** was published
  10 September at 14:21 UTC and was under one day old. The
  [8.30 release](https://github.com/orval-labs/orval/releases/tag/v8.30.0)
  includes additional generation security fixes. Existing major 8 is retained and
  transitive js-yaml is separately patched. Its current configuration uses
  `formatter: "prettier"` and explicit `zod.version: 3`: the installed Orval declarations
  confirm these options, avoiding its auto-detection fallback to Zod 4 with catalogs.
- Drizzle ORM **0.45.2** meets the audit's patched range and preserves its existing API.
  [Maintainer release](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.2).
- Vite **7.3.6** retains major 7 and exceeds all reported patched ranges.
  [Maintainer release](https://github.com/vitejs/vite/releases/tag/v7.3.6).
- YAML **2.9.0** is a direct api-spec development dependency, above the required 2.8.3 fix.
  [Maintainer release](https://github.com/eemeli/yaml/releases/tag/v2.9.0).
- Exact, major-scoped transitive overrides follow each affected audit path:
  lodash **4.18.0**; PostCSS **8.5.23**; js-yaml **4.3.2**;
  picomatch **2.3.2 / 4.0.4**; brace-expansion **2.1.4**;
  fast-uri **3.1.6**; nanoid **3.3.18**; browserslist **4.28.7**;
  baseline-browser-mapping **2.11.0**; @babel/core **7.29.6**;
  markdown-it **14.2.0**; linkify-it **5.0.2**. Existing esbuild override advances
  from vulnerable 0.27.3 to **0.28.1** within major 0. Each selected release is
  older than one day. The full before report retains exact affected dependency paths,
  advisory URLs, and patched ranges; notably the
  [PostCSS advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) and
  [js-yaml advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
  require fixes beyond earlier 8.5.x / 4.x patches. The final audit confirms no remaining paths.

Gateway directly declares the existing workspace Zod 3 dependency. On behalf of the
readiness task it also declares pg **8.20.0** and @types/pg **8.18.0**, matching the
workspace's existing compatible selections. Root Playwright **1.63.0** and peerbridge
`tsx: catalog:` were installed for the following UI test task; Playwright was published
4 September 2026 and independently verified by the coordinator against its
[official release notes](https://playwright.dev/docs/release-notes).

Verification: two consecutive complete code-generation runs produce identical files;
contract inventory, full workspace type checking, gateway tests, and disposable local
PostgreSQL tests pass. No application Python, migration ledger, or existing 0001/0002
migration was edited. The DB suite's optional real Python API case remains skipped
without its external interpreter opt-in.
