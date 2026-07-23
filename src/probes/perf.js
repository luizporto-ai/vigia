/**
 * Performance probe — runs Lighthouse programmatically and turns the key lab
 * metrics into findings + a pass/fail budget. Optional: if Lighthouse isn't
 * installed, it skips with a friendly note.
 *
 * Honesty: these are LAB numbers (one device/network) — repeatable and great as
 * a regression gate, but INP and lifetime-CLS need real field/CrUX data. We say so.
 *
 * Sources: web.dev Core Web Vitals thresholds, Lighthouse docs.
 */

import { SEVERITY, STATUS } from '../core/finding.js';
import { serveDir } from '../core/serve.js';

// "Good" thresholds (p75 field targets, used here as lab budgets).
const BUDGET = {
  lcpMs: 2500, // web.dev LCP good
  cls: 0.1, // web.dev CLS good
  tbtMs: 200, // lab proxy for INP
  totalBytes: 1_600_000, // aggressive-but-sane page weight
};

export default {
  id: 'perf',
  title: 'Performance (Lighthouse lab metrics + budget)',
  appliesTo: () => true,

  async run(ctx) {
    let lighthouse, chromeLauncher;
    try {
      lighthouse = (await import('lighthouse')).default;
      chromeLauncher = await import('chrome-launcher');
    } catch {
      return [
        {
          id: 'perf/not-installed',
          title: 'Performance probe skipped — Lighthouse not installed',
          status: STATUS.INFO,
          severity: SEVERITY.INFO,
          evidence: 'The performance budget needs Lighthouse.',
          remediation: 'Install it: `npm i -D lighthouse`. (It brings chrome-launcher.) Then re-run vigia.',
          source: 'https://github.com/GoogleChrome/lighthouse',
        },
      ];
    }

    let baseUrl = ctx.target.url;
    let server = null;
    if (ctx.target.type === 'dir') {
      server = await serveDir(ctx.target.dir);
      baseUrl = server.url;
    }

    let chrome;
    try {
      chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
      const runner = await lighthouse(
        baseUrl,
        { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] },
      );
      return interpret(runner.lhr);
    } catch (err) {
      return [
        {
          id: 'perf/failed',
          title: 'Performance probe could not complete',
          status: STATUS.INFO,
          severity: SEVERITY.INFO,
          evidence: err.message,
          remediation: 'Ensure a Chrome/Chromium is installed for chrome-launcher (or run `npx playwright install chromium`).',
          source: 'https://github.com/GoogleChrome/lighthouse',
        },
      ];
    } finally {
      if (chrome) await chrome.kill();
      if (server) await server.close();
    }
  },
};

function interpret(lhr) {
  const findings = [];
  const a = lhr.audits;
  const num = (id) => a[id]?.numericValue;

  const score = Math.round((lhr.categories.performance?.score ?? 0) * 100);
  findings.push({
    id: 'perf/score',
    title: `Lighthouse performance score: ${score}/100`,
    status: score >= 90 ? STATUS.PASS : score >= 50 ? STATUS.WARN : STATUS.FAIL,
    severity: score >= 90 ? SEVERITY.INFO : score >= 50 ? SEVERITY.MEDIUM : SEVERITY.HIGH,
    evidence: `Lab score (one device/network). Field/CrUX may differ.`,
    remediation: 'See the individual metric findings below for the biggest wins.',
    source: 'https://developer.chrome.com/docs/lighthouse/performance/performance-scoring',
  });

  metric(findings, 'perf/lcp', 'Largest Contentful Paint', num('largest-contentful-paint'), BUDGET.lcpMs, 'ms', {
    high: SEVERITY.HIGH,
    fix: 'Remove loading=lazy + add fetchpriority=high on the LCP image; preload critical font; cut render-blocking CSS/JS.',
    src: 'https://web.dev/articles/lcp',
  });
  metric(findings, 'perf/cls', 'Cumulative Layout Shift', num('cumulative-layout-shift'), BUDGET.cls, '', {
    high: SEVERITY.HIGH,
    fix: 'Set width/height (or aspect-ratio) on images/embeds; reserve space for injected content; preload fonts.',
    src: 'https://web.dev/articles/cls',
    note: 'Lab CLS only captures load-time shifts — field CLS covers the full page lifetime.',
  });
  metric(findings, 'perf/tbt', 'Total Blocking Time (INP proxy)', num('total-blocking-time'), BUDGET.tbtMs, 'ms', {
    high: SEVERITY.MEDIUM,
    fix: 'Break up long tasks, defer non-critical JS, code-split, move heavy work to a Web Worker.',
    src: 'https://web.dev/articles/tbt',
    note: 'TBT is a lab proxy — real interactivity (INP) needs field data.',
  });
  metric(findings, 'perf/weight', 'Total page transfer weight', num('total-byte-weight'), BUDGET.totalBytes, 'bytes', {
    high: SEVERITY.MEDIUM,
    fix: 'Ship modern image formats (WebP/AVIF), tree-shake/minify JS, enable brotli, lazy-load below-fold.',
    src: 'https://web.dev/articles/your-first-performance-budget',
  });

  // A couple of high-signal opportunity audits, if present and failing.
  opportunity(findings, a, 'uses-text-compression', 'Enable text compression', SEVERITY.HIGH);
  opportunity(findings, a, 'render-blocking-resources', 'Eliminate render-blocking resources', SEVERITY.MEDIUM);
  opportunity(findings, a, 'unused-javascript', 'Reduce unused JavaScript', SEVERITY.MEDIUM);
  opportunity(findings, a, 'modern-image-formats', 'Serve images in modern formats', SEVERITY.MEDIUM);

  return findings;
}

function metric(findings, id, name, value, budget, unit, { high, fix, src, note }) {
  if (value == null) return;
  const shown = unit === 'bytes' ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${Math.round(value)}${unit}`;
  const budgetShown = unit === 'bytes' ? `${(budget / 1024 / 1024).toFixed(2)} MB` : `${budget}${unit}`;
  const pass = value <= budget;
  findings.push({
    id,
    title: `${name}: ${shown} (budget ${budgetShown})`,
    status: pass ? STATUS.PASS : STATUS.FAIL,
    severity: pass ? SEVERITY.INFO : high,
    evidence: (pass ? 'Within budget.' : `Over budget by ${unit === 'bytes' ? ((value - budget) / 1024 / 1024).toFixed(2) + ' MB' : Math.round(value - budget) + unit}.`) + (note ? ` (${note})` : ''),
    remediation: fix,
    source: src,
  });
}

function opportunity(findings, audits, auditId, title, severity) {
  const audit = audits[auditId];
  if (!audit || audit.score == null || audit.score >= 0.9) return;
  const savings = audit.details?.overallSavingsMs;
  findings.push({
    id: `perf/${auditId}`,
    title,
    status: STATUS.WARN,
    severity,
    evidence: (audit.displayValue || 'Lighthouse flagged this opportunity.') + (savings ? ` (~${Math.round(savings)}ms)` : ''),
    remediation: audit.description?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').split('. ')[0] || 'See Lighthouse docs.',
    source: 'https://developer.chrome.com/docs/lighthouse/performance/' + auditId,
  });
}
