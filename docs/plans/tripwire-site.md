# Tripwire public website

11 October 2026. Based on integration `b3d88e3`, including the teammate's
screened-escrow operator and discovery work. Website delivery is separate from
H4c4 review, issuer integration, payment deployment/consent and real receipts.

## Public contract

- `/`: Tripwire product overview. Interactive payment examples are explicitly
  illustrative and grant no execution permission. Copy distinguishes the
  implemented screened workflow from the outstanding real-pilot gates.
- `/tripwire/operations`: read-only public-report viewer. The example button
  uses the existing synthetic worker fixture through the same size-limited
  importer as a selected file. It preserves the original capture time, scope,
  payment states, amounts and report limitations. Loading it disconnects a
  followed folder and clears previous filters/errors. Synthetic receipt IDs
  render as text; non-synthetic imported receipts retain explorer links.
- `/tripwire`: synthetic local-EVM guardian replay, separate from the current
  screened escrow. Incident URLs and existing replay controls remain available.
- `/app`: replace-redirect to operations. `/check` and `/v2`: replace-redirect
  to the product overview. Old query data is discarded, not sent to a provider.
- Unknown URLs show a Tripwire 404 view. Vercel's existing SPA rewrite still
  returns the shell with HTTP 200; this is a visual 404, not an edge status.

The public route graph does not import the old wallet-analysis, tax or prototype
pages. Shared underlying analysis services remain in the repository for existing
contract facts and regression coverage. Historical documentation/social material
is not rewritten as a new product capability and is not copied to `dist`.

## Identity and presentation

Tripwire is the only public wordmark, navigation identity, page title and export
brand in current source. Old PNG wordmarks are removed from `public/brand/`.
The vector mark, favicon and an editable 1200 × 630 social card use the Tripwire
identity. Social image metadata uses the existing Vercel origin; rename it only
when a new canonical domain is actually configured.

Existing Geist and Space Grotesk fonts are served locally. The obsolete Google
font download and initial font-gating script are removed. The theme is stored
under `tripwire-theme`; the old theme choice remains a read-only fallback.
The menu fits tablet widths, closes on Escape, exposes controls/expanded state,
and includes operations and theme controls on mobile. Each page has a skip target.

## Motion

The original shared motion components are restored for Tripwire: silk hero
field, hex headline/status decoding, desktop scroll parallax, pointer tilt and
magnetic CTAs, spotlight cards, word reveals and the scroll-responsive ticker.
Payment checks scan and stagger on explicit scenario selection. Mobile reading
copy has a stronger veil; mobile/touch cards do not tilt or use parallax. The
closing section retains the original still colour horizon. See
[the motion contract](../design-motion.md) for reduced-motion behavior.

## Validation and delivery

Run `npm run build`, `npm run lint` and `npm test -- --maxWorkers=2 --minWorkers=1`.
There is no separate `typecheck` or `test:golden` script; build performs the
configured TypeScript builds. Existing contract artifacts were not regenerated.

Browser acceptance covers desktop, 390 px and 320 px: all public and retired
routes, no horizontal overflow, Tripwire titles/identity, payment examples,
FAQ/menu/theme, operations example/filter/search/clear, original capture age,
nonclickable synthetic receipt IDs and replay step/play/reset. The existing
route smoke script also checks identity, titles, legacy redirect and visual 404.
Motion acceptance additionally covers heading readability/accents, settled
section/list visibility, pointer tilt, payment holds, mobile card angles and
no overflow. A temporary local fixture simulates the reduced-motion JS media
query and applies the same reduced-motion ticker CSS: plain text, no glyphs or
scan flags, visible headings/blocks, still ticker and zero tilt were verified.
The fixture is removed after QA and never committed or deployed. Native OS
preferences were not changed.

Native directory-picker/permission behavior and live payment evidence remain
the gates recorded in the operations runbook, not website test claims.

Delivery follows `AGENTS.md`: own branch, PR into `main`, no direct main push. Check CI and
the exact deployment commit before claiming the requested live update. The site's existing hosting is Vercel; no duplicate Sites
project, new backend, issuer subscription or payment transaction is introduced.
