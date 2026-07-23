/**
 * Human-facing terminal report. No color deps — plain ANSI, degrades to plain
 * text when not a TTY.
 */

import { TYPE } from '../core/finding.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);

const SEV_ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };
const STATUS_ICON = { fail: '✗', warn: '!', pass: '✓', info: 'i' };

export function renderTerminal(report) {
  const { target, findings, summary } = report;
  const lines = [];
  const where = target.type === 'url' ? target.url : target.dir;

  lines.push('');
  lines.push(bold(`  vigia  ${dim('→')}  ${where}`));
  lines.push('');

  // Summary line
  const s = summary;
  const head =
    `  ${s.bySeverity.critical} critical · ${s.bySeverity.high} high · ${s.bySeverity.medium} medium · ` +
    `${s.bySeverity.low} low   ${dim(`(${s.pass} passed)`)}`;
  lines.push(head);
  lines.push('');

  // Group: failures/warnings first (already sorted by engine), then hypotheses, then passes summary.
  const problems = findings.filter((f) => f.status === 'fail' || f.status === 'warn');
  const hypotheses = findings.filter((f) => f.type === TYPE.HYPOTHESIS && f.status === 'info');
  const passes = findings.filter((f) => f.status === 'pass');

  if (problems.length) {
    lines.push(bold('  Findings'));
    for (const f of problems) lines.push(...renderFinding(f));
    lines.push('');
  }

  if (hypotheses.length) {
    lines.push(bold('  Hypotheses & runbooks ') + dim('(cannot be proven headless — needs a real device)'));
    for (const f of hypotheses) lines.push(...renderFinding(f));
    lines.push('');
  }

  if (passes.length) {
    lines.push(dim(`  ✓ ${passes.length} checks passed`));
    lines.push('');
  }

  // Verdict / hypothesis honesty footer
  lines.push(dim(`  ${s.verdicts} verdicts (proven) · ${s.hypotheses} hypotheses (need a device to confirm)`));
  lines.push('');

  return lines.join('\n');
}

function renderFinding(f) {
  const out = [];
  const icon = SEV_ICON[f.severity] || '⚪';
  const tag =
    f.confidence === 'proven'
      ? ''
      : dim(f.confidence === 'heuristic' ? '  [heuristic]' : '  [needs device]');
  out.push(`  ${icon} ${bold(f.title)}${tag}`);
  if (f.evidence) out.push(dim(`     ${wrap(f.evidence, 92, '     ')}`));
  if (f.remediation) out.push(`     ${c('36', '→')} ${wrap(f.remediation, 92, '       ')}`);
  if (f.source) out.push(dim(`     ${f.source}`));
  out.push('');
  return out;
}

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join('\n' + indent);
}
