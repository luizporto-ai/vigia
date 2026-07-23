import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { finding, sortFindings, TYPE, CONFIDENCE, STATUS } from '../src/core/finding.js';
import { resolveTarget, runAudit } from '../src/core/engine.js';

test('finding() fills defaults and validates enums', () => {
  const f = finding({ id: 'x/y', title: 'hi' });
  assert.equal(f.type, TYPE.VERDICT);
  assert.equal(f.confidence, CONFIDENCE.PROVEN);
  assert.equal(f.probe, 'x');
});

test('finding() defaults a hypothesis to needs-device', () => {
  const f = finding({ id: 'a/b', title: 't', type: TYPE.HYPOTHESIS });
  assert.equal(f.confidence, CONFIDENCE.NEEDS_DEVICE);
});

test('finding() rejects bad enums', () => {
  assert.throws(() => finding({ id: 'a/b', title: 't', severity: 'nope' }));
});

test('finding() requires id and title', () => {
  assert.throws(() => finding({ title: 't' }));
  assert.throws(() => finding({ id: 'a/b' }));
});

test('sortFindings puts failures before passes and orders by severity', () => {
  const sorted = sortFindings([
    finding({ id: 'a/pass', title: 'p', status: STATUS.PASS, severity: 'info' }),
    finding({ id: 'a/low', title: 'l', status: STATUS.FAIL, severity: 'low' }),
    finding({ id: 'a/crit', title: 'c', status: STATUS.FAIL, severity: 'critical' }),
  ]);
  assert.equal(sorted[0].severity, 'critical');
  assert.equal(sorted[1].severity, 'low');
  assert.equal(sorted[2].status, 'pass');
});

test('resolveTarget distinguishes url from dir and rejects garbage', () => {
  assert.equal(resolveTarget('https://example.com').type, 'url');
  assert.throws(() => resolveTarget('./definitely-not-a-real-path-xyz'));
});

test('static probe catches the incident bugs on a local dir (no network/browser)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vigia-test-'));
  writeFileSync(
    path.join(dir, 'index.html'),
    `<!doctype html><html><head><title>t</title>
     <style>.g{filter:blur(160px)} .glass{backdrop-filter:blur(8px)}</style>
     </head><body></body></html>`
  );
  const report = await runAudit(dir, { only: ['static'] });
  const ids = report.findings.map((f) => f.id);
  assert.ok(ids.includes('static/viewport-meta'), 'flags missing viewport');
  assert.ok(ids.includes('static/gpu-blur-risk'), 'flags heavy blur');
  assert.ok(ids.includes('static/backdrop-filter-prefix'), 'flags missing -webkit- prefix');

  const blur = report.findings.find((f) => f.id === 'static/gpu-blur-risk');
  assert.equal(blur.type, TYPE.HYPOTHESIS, 'blur risk is a hypothesis, not a verdict');
  assert.equal(blur.confidence, CONFIDENCE.HEURISTIC);
});
