/**
 * The engine: resolve the target, run every applicable probe, collect findings,
 * summarize. Probes are run sequentially — several drive a headless browser and
 * we'd rather be predictable about resource use than shave a few seconds.
 */

import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createContext } from './context.js';
import { finding, sortFindings, STATUS, TYPE, severityRank } from './finding.js';
import { PROBES } from '../probes/index.js';

export function resolveTarget(raw) {
  if (/^https?:\/\//i.test(raw)) {
    return { type: 'url', url: raw.replace(/\/$/, '') + (new URL(raw).pathname === '/' ? '/' : '') };
  }
  // Treat as a local directory (a built site: dist/, build/, out/, public/)
  let isDir = false;
  try {
    isDir = statSync(raw).isDirectory();
  } catch {
    /* fall through */
  }
  if (isDir) return { type: 'dir', dir: raw };
  throw new Error(
    `Target "${raw}" is neither an http(s) URL nor an existing directory.\n` +
      `Usage: vigia <https://your-site.com | ./dist>`
  );
}

/**
 * @param {string} rawTarget
 * @param {object} options
 * @returns {Promise<object>} report
 */
export async function runAudit(rawTarget, options = {}) {
  const target = resolveTarget(rawTarget);
  const ctx = createContext(target, options);

  const selected = PROBES.filter((p) => {
    if (options.only && !options.only.includes(p.id)) return false;
    if (options.skip && options.skip.includes(p.id)) return false;
    return p.appliesTo(target);
  });

  const findings = [];
  const probeRuns = [];

  for (const probe of selected) {
    const t0 = Date.now();
    try {
      const out = (await probe.run(ctx)) || [];
      const normalized = out.map((f) => finding({ probe: probe.id, ...f }));
      findings.push(...normalized);
      probeRuns.push({ id: probe.id, ok: true, count: normalized.length, ms: Date.now() - t0 });
    } catch (err) {
      probeRuns.push({ id: probe.id, ok: false, error: err.message, ms: Date.now() - t0 });
      findings.push(
        finding({
          id: `${probe.id}/probe-error`,
          probe: probe.id,
          title: `Probe "${probe.id}" could not run`,
          status: STATUS.INFO,
          severity: 'info',
          evidence: err.message,
          remediation:
            'This usually means an optional dependency (e.g. Playwright browsers) is missing. ' +
            'Run `npx playwright install` for render/perf probes.',
        })
      );
    }
  }

  const sorted = sortFindings(findings);
  return {
    tool: 'vigia',
    version: '0.1.0',
    target,
    startedAt: options.now || null,
    probeRuns,
    findings: sorted,
    summary: summarize(sorted),
  };
}

function summarize(findings) {
  const s = {
    total: findings.length,
    fail: 0,
    warn: 0,
    pass: 0,
    info: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    verdicts: 0,
    hypotheses: 0,
    worstSeverity: 'info',
  };
  let worst = 9;
  for (const f of findings) {
    s[f.status] = (s[f.status] || 0) + 1;
    if (f.type === TYPE.HYPOTHESIS) s.hypotheses++;
    else s.verdicts++;
    if (f.status === STATUS.FAIL || f.status === STATUS.WARN) {
      s.bySeverity[f.severity] = (s.bySeverity[f.severity] || 0) + 1;
      const r = severityRank(f.severity);
      if (r < worst) {
        worst = r;
        s.worstSeverity = f.severity;
      }
    }
  }
  // Exit code contract for CI: fail if any critical/high verdict failed.
  s.ciPass = s.bySeverity.critical === 0 && s.bySeverity.high === 0;
  return s;
}

// Allow `node src/core/engine.js <url>` for quick manual runs.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runAudit(process.argv[2]).then((r) => console.log(JSON.stringify(r, null, 2)));
}
