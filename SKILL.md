---
name: vigia
description: Use when you need to audit a website or a local build for responsiveness, cross-browser rendering (including WebKit/Safari), broken layout, smoke errors (JS exceptions, failed assets, broken images), HTTP delivery config (compression, caching, security headers, redirects), and performance (Lighthouse budget). vigia diagnoses and never edits code. Trigger when the user asks "is my site broken / responsive / fast / working on Safari", "audit this site", "why won't it load", "check my deploy", or before shipping a frontend change.
---

# vigia — website auditor (diagnose, never fix)

vigia runs a battery of probes against a URL or a local build directory and returns
a prioritized report. Your job as the agent: **run it, read the JSON, and act on the
findings** — vigia itself only diagnoses.

## Run it

```bash
# Live URL
npx vigia https://example.com --json /tmp/vigia.json

# Local build (serves the dir in a headless browser)
npx vigia ./dist --json /tmp/vigia.json

# CI gate (exit 1 if any critical/high verdict fails)
npx vigia https://example.com --ci

# Scope to cheap probes (no browser needed)
npx vigia https://example.com --only headers,static,dns
```

Full browser/perf coverage needs Playwright + Lighthouse once:
`npm i -D playwright lighthouse @axe-core/playwright && npx playwright install`.
Without them, the render/perf probes **skip gracefully** (headers/static/dns still run).

## Read the JSON

`report.findings[]` — each finding:

| field | meaning |
|---|---|
| `type` | `verdict` = proven fact · `hypothesis` = can't be proven headless |
| `confidence` | `proven` · `heuristic` · `needs-device` |
| `status` | `fail` · `warn` · `pass` · `info` |
| `severity` | `critical` · `high` · `medium` · `low` · `info` |
| `evidence` | what vigia observed |
| `remediation` | how to fix it |
| `source` | authoritative reference URL |

`report.summary` — counts + `worstSeverity` + `ciPass` (false if any critical/high failed).

## How to act on findings (the intelligence)

1. **Trust verdicts, weigh hypotheses.** A `verdict` (missing header, horizontal
   overflow, asset 404) is a fact — fix it. A `hypothesis` (`static/gpu-blur-risk`,
   `dns/private-relay-runbook`) is a strong signal that a headless scan **cannot
   prove** — present it to the user as "worth checking on a real device," never as
   a confirmed bug. Do not overstate.

2. **Order by severity, then by cheapness of fix.** Critical/high first. Many
   header findings are one line of nginx/CDN config — batch them.

3. **Translate, don't parrot.** Turn `remediation` into a concrete edit for *this*
   codebase (find the CSS rule, the nginx conf, the `<img>` missing dimensions).

4. **The incident pattern.** If the user reports "loads in Chrome, blank in Safari
   on iPhone": the render probe + `dns/private-relay-runbook` finding tell you to
   **read the server access log FIRST** (did the request even arrive?) before
   touching CSS. Zero Safari hits ⇒ the problem is DNS/Private-Relay, not your code.

5. **Blur/GPU risk.** `static/gpu-blur-risk` means heavy `filter: blur()` glows.
   Recommend replacing with `radial-gradient(closest-side, rgba(...), transparent)`
   — near-identical pixels, a fraction of the GPU cost. It's the #1 cause of
   "works on desktop, janky/blank on iPhone."

6. **After fixing, re-run vigia** to confirm the verdict flipped to `pass`.

## Honesty contract

vigia's value is that it **won't lie**. Headless Linux WebKit ≠ real Safari (no
Metal GPU, no CoreText fonts, no Private Relay). Anything vigia can't reproduce it
labels `needs-device` and hands you a runbook instead of a fake pass. Preserve that
honesty when you relay results to the user.
