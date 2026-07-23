<h1 align="center">vigia</h1>

<p align="center"><b>Your lookout for what breaks before users do.</b></p>

<p align="center">
An honest, framework-agnostic website auditor. Responsiveness · cross-browser rendering
(including <b>WebKit/Safari</b>) · broken layout · smoke errors · HTTP delivery · performance —
one prioritized report.<br/>
<b>It diagnoses. It never touches your code.</b>
</p>

<p align="center">
  <a href="#license"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-black"></a>
  <img alt="node >=18" src="https://img.shields.io/badge/node-%E2%89%A518.17-black">
  <img alt="WebKit tested" src="https://img.shields.io/badge/WebKit-tested-black">
  <img alt="Claude Skill" src="https://img.shields.io/badge/Claude-Skill-black">
</p>

---

## Try it in 5 seconds (no install)

```bash
npx vigia https://your-site.com
```

That's it. You get a ranked report: 🔴 blockers → 🟡 warnings → ✓ passes — each with
evidence, a fix, and an authoritative source link.

```
  vigia  →  https://your-site.com

  0 critical · 3 high · 3 medium · 2 low   (2 passed)

  🟠 No text compression on the HTML document
     → Enable brotli/gzip for text MIME types at the edge. Send Vary: Accept-Encoding.
  🟠 Missing Content-Security-Policy
     → Add default-src 'self'; object-src 'none'; frame-ancestors 'none'
  🟠 2 heavy filter: blur() glows — GPU-memory risk on iOS Retina  [heuristic]
     → Replace with radial-gradient; big blur is the #1 cause of "janky/blank on iPhone"
  ...
  Hypotheses & runbooks (needs a real device)
  ⚪ Loads in Chrome but not Safari on iPhone? — Private Relay runbook  [needs device]
```

## What vigia checks

```
📱 Responsiveness   horizontal overflow, breakpoint sweep, tap-target size, viewport meta
🧭 Cross-browser    Chromium · Firefox · WebKit — render + JS + missing -webkit- prefixes
🧱 Broken layout    off-canvas elements, broken images, zero-size targets
💥 Smoke errors     uncaught JS, console errors, 4xx/5xx assets (catches "white screen after deploy")
🚚 Delivery / HTTP  compression, caching, security headers, HTTP→HTTPS & www redirects
⚡ Performance      Lighthouse LCP / CLS / TBT + page-weight budget
♿ Accessibility    axe-core smoke: alt, labels, button names, color contrast
```

## What vigia **is** (and isn't)

This is the part most tools won't tell you.

- ✔ It's an **auditor**: it finds and ranks problems and tells you exactly where to look.
- ✘ It's **not a fixer**: it never edits your code, config, or deploys anything.
- ✔ **WebKit-honest.** We run *real* WebKit via Playwright. But headless Linux WebKit is
  **not** byte-identical to Safari on a real iPhone — no Metal GPU, no CoreText fonts, no
  iCloud Private Relay. So anything we can't reproduce we label **`needs-device`** and hand
  you a runbook — instead of a fake green check. Most tools imply "Safari coverage" and
  quietly run Chromium. We say the limit out loud.
- ✘ It won't catch business-logic bugs, auth-walled flows, or design taste.

Every finding is one of two kinds: a **verdict** (proven fact) or a **hypothesis**
(a strong signal only a real device can confirm). vigia never dresses one up as the other.

## Install

### For developers

```bash
npx vigia <url|dir>              # one-off, no install
npm i -D vigia                   # project dependency

# full cross-browser + performance coverage (once):
npm i -D playwright lighthouse @axe-core/playwright && npx playwright install
```

### In CI

```yaml
# .github/workflows/vigia.yml
- run: npx vigia https://your-site.com --ci --md vigia-report.md
```

`--ci` exits non-zero if any critical/high **verdict** fails.

### For AI coding agents (Claude Code, Codex, Cursor…)

vigia ships a `SKILL.md` at the repo root. Point your agent at this repo and it learns
to run vigia, read the JSON, prioritize, and translate findings into concrete edits — then
re-run to confirm the fix. Then just ask: *"audit https://example.com and fix the blockers."*

## Usage

```
vigia <url|dir> [options]

  --json [file]   Write JSON report (file, or stdout if omitted)
  --md <file>     Write a Markdown report (great for PR comments)
  --only <ids>    Run only these probes: headers,static,dns,render,perf
  --skip <ids>    Skip probes
  --ci            Exit non-zero on any critical/high verdict failure
```

## How it works

Headless browsers (Playwright, 3 engines) for render/layout/JS · plain HTTP requests for
delivery headers · static HTML/CSS parsing for prefix and GPU-blur risk · Lighthouse for the
performance budget · `dig`-style DNS delegation snapshot for the Safari/Private-Relay runbook.
No magic, no telemetry, no network calls except to the site you point it at.

## Contributing

A check is one file in `src/probes/` exporting `{ id, title, appliesTo, run(ctx) }` and
returning findings. That's the whole extension model — new checks are welcome PRs. See
`docs/DESIGN.md` for the architecture and the finding schema.

## License

MIT — see [LICENSE](LICENSE).
