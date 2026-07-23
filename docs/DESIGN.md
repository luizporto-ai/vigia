# vigia — design

## Premise

An honest, framework-agnostic website auditor. It **diagnoses and never edits**.
Its differentiator is a hard structural rule: it separates what it can **prove**
(verdicts) from what it can only **suspect** (hypotheses), and never dresses one
up as the other.

## Two-class finding model

Born from a real incident where a site "wouldn't load on iPhone" due to two
independent problems in different layers:

1. Heavy `filter: blur()` glows → GPU-memory blowup on iOS Retina (render layer).
2. iCloud Private Relay + stale DNS delegation → Safari never reached the server
   (client-network layer).

The first is statically detectable as a *heuristic*; the second is **not**
server-detectable at all — only a runbook is honest. Hence:

- **verdict** (`confidence: proven`) — a fact a headless scan establishes.
- **hypothesis** (`confidence: heuristic | needs-device`) — a signal that only a
  real device can confirm; shipped with a runbook, never as a pass/fail gate.

## Architecture

```
bin/cli.js            → arg parsing, output, exit codes
src/core/
  finding.js          → Finding schema, enums, normalizer, sort  (the honesty contract)
  context.js          → per-run context: http() cache, viewports, readLocal()
  engine.js           → resolveTarget + run applicable probes + summarize
  serve.js            → tiny static server so probes can load a local dir in a browser
src/probes/           → one file per probe: { id, title, appliesTo, run(ctx) => Finding[] }
  headers.js          → compression, cache, security headers, redirects   (url only)
  static-scan.js      → viewport meta, -webkit- prefix, GPU-blur risk      (url + dir)
  dns.js              → delegation snapshot + Private-Relay runbook         (url only)
  render.js           → Playwright chromium/webkit/firefox: overflow sweep, smoke, a11y, tap targets
  perf.js             → Lighthouse LCP/CLS/TBT + weight budget
src/report/
  terminal.js         → human TTY output
  markdown.js         → CI artifact / PR comment / shareable report
```

### Probe contract

```js
export default {
  id: 'headers',
  title: 'HTTP delivery & security headers',
  appliesTo: (target) => target.type === 'url',   // 'url' | 'dir'
  async run(ctx) { return [ /* raw finding objects */ ]; },
};
```

`run` returns plain objects; the engine normalizes them through `finding()`.
Adding a check = adding a file here and registering it in `src/probes/index.js`.

### Graceful degradation

`playwright`, `lighthouse`, and `@axe-core/playwright` are **optional**
dependencies. If absent, the render/perf probes emit an `info` finding telling the
user how to install them, and the cheap probes (headers/static/dns) still run. So
`npx vigia <url>` always does something useful with zero setup.

### Target resolution

- `http(s)://…` → URL target: all probes.
- an existing directory → dir target: static + render + perf (served locally);
  headers/dns are skipped (nothing to inspect at the HTTP/DNS layer).

## Honesty guarantees (non-negotiable)

- Playwright WebKit ≠ branded Safari — no Metal GPU, CoreText, or Private Relay.
  Anything needing those is `needs-device`.
- Lighthouse numbers are **lab** (repeatable, one device). INP and lifetime-CLS
  need field/CrUX data — findings say so.
- `--ci` fails only on **critical/high verdicts** — never on a hypothesis.

## Distribution

Published to npm (`vigia`) and GitHub. Runs entirely on the user's machine — no
server, no telemetry, no phone-home. The repo root `SKILL.md` makes it installable
by AI coding agents (Claude Code, Codex) as a skill.
