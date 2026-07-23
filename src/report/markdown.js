/**
 * Markdown report — for CI artifacts, PR comments, and the shareable-report angle.
 */

import { TYPE } from '../core/finding.js';

const SEV_ICON = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵', info: '⚪' };

export function renderMarkdown(report) {
  const { target, findings, summary: s } = report;
  const where = target.type === 'url' ? target.url : target.dir;
  const md = [];

  md.push(`# vigia report`);
  md.push('');
  md.push(`**Target:** \`${where}\``);
  md.push('');
  md.push(
    `**Summary:** ${s.bySeverity.critical} critical · ${s.bySeverity.high} high · ${s.bySeverity.medium} medium · ` +
      `${s.bySeverity.low} low · ${s.pass} passed`
  );
  md.push('');
  md.push(`> ${s.verdicts} verdicts (proven) · ${s.hypotheses} hypotheses (need a real device to confirm)`);
  md.push('');

  const problems = findings.filter((f) => f.status === 'fail' || f.status === 'warn');
  const hypotheses = findings.filter((f) => f.type === TYPE.HYPOTHESIS && f.status === 'info');

  if (problems.length) {
    md.push(`## Findings`);
    md.push('');
    for (const f of problems) md.push(...fBlock(f));
  }

  if (hypotheses.length) {
    md.push(`## Hypotheses & runbooks`);
    md.push('');
    md.push(`_These cannot be proven by a headless scan — they need a real device. vigia flags them honestly instead of pretending._`);
    md.push('');
    for (const f of hypotheses) md.push(...fBlock(f));
  }

  md.push(`---`);
  md.push(`<sub>audited by [vigia](https://github.com/luizporto-ai/vigia)</sub>`);
  md.push('');
  return md.join('\n');
}

function fBlock(f) {
  const out = [];
  const conf = f.confidence === 'proven' ? '' : ` \`${f.confidence}\``;
  out.push(`### ${SEV_ICON[f.severity]} ${f.title}${conf}`);
  out.push('');
  if (f.evidence) out.push(f.evidence);
  if (f.remediation) {
    out.push('');
    out.push(`**Fix:** ${f.remediation.replace(/\n/g, '  \n')}`);
  }
  if (f.source) {
    out.push('');
    out.push(`[reference](${f.source})`);
  }
  out.push('');
  return out;
}
