/**
 * The Finding — the honest unit of the whole tool.
 *
 * Every check emits Findings. The two fields that keep vigia from lying are
 * `type` and `confidence`:
 *
 *   type = 'verdict'      → we PROVED it (a fact: header missing, scrollbar exists)
 *   type = 'hypothesis'   → we can't prove it headless, we flag it + give a runbook
 *
 *   confidence = 'proven'       → reproducible and deterministic
 *   confidence = 'heuristic'    → a strong signal, not a guarantee (e.g. GPU-blur risk)
 *   confidence = 'needs-device' → only a real device/browser can confirm (Safari GPU, Private Relay)
 *
 * A tool that dresses a hypothesis up as a verdict is worse than useless. This
 * schema makes that dishonesty structurally impossible.
 */

export const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
});

export const STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  WARN: 'warn',
  INFO: 'info',
});

export const TYPE = Object.freeze({
  VERDICT: 'verdict',
  HYPOTHESIS: 'hypothesis',
});

export const CONFIDENCE = Object.freeze({
  PROVEN: 'proven',
  HEURISTIC: 'heuristic',
  NEEDS_DEVICE: 'needs-device',
});

const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Normalize a raw finding object, filling defaults and validating enums.
 * @param {object} f
 * @returns {object} finding
 */
export function finding(f) {
  if (!f || typeof f !== 'object') {
    throw new TypeError('finding() expects an object');
  }
  if (!f.id) throw new Error('finding requires a stable `id` (e.g. "headers/compression")');
  if (!f.title) throw new Error(`finding ${f.id} requires a title`);

  const type = f.type || TYPE.VERDICT;
  const status = f.status || STATUS.FAIL;
  const severity = f.severity || (status === STATUS.PASS ? SEVERITY.INFO : SEVERITY.MEDIUM);
  const confidence =
    f.confidence || (type === TYPE.HYPOTHESIS ? CONFIDENCE.NEEDS_DEVICE : CONFIDENCE.PROVEN);

  assertEnum('type', type, TYPE);
  assertEnum('status', status, STATUS);
  assertEnum('severity', severity, SEVERITY);
  assertEnum('confidence', confidence, CONFIDENCE);

  return {
    id: f.id,
    probe: f.probe || f.id.split('/')[0],
    title: f.title,
    type,
    status,
    severity,
    confidence,
    evidence: f.evidence || '',
    affected: f.affected || null, // url / css selector / file:line
    remediation: f.remediation || '',
    source: f.source || null, // authoritative reference URL
    meta: f.meta || {}, // free-form structured extras
  };
}

/** A pass finding — sugar so probes can report the good news too. */
export function pass(id, title, extra = {}) {
  return finding({
    id,
    title,
    status: STATUS.PASS,
    severity: SEVERITY.INFO,
    ...extra,
  });
}

/** Sort findings: failures before passes, then by severity, then by id. */
export function sortFindings(findings) {
  const statusRank = { fail: 0, warn: 1, info: 2, pass: 3 };
  return [...findings].sort((a, b) => {
    const s = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (s !== 0) return s;
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.id.localeCompare(b.id);
  });
}

export function severityRank(sev) {
  return SEVERITY_RANK[sev] ?? 9;
}

function assertEnum(name, value, enumObj) {
  const allowed = Object.values(enumObj);
  if (!allowed.includes(value)) {
    throw new Error(`invalid ${name} "${value}" — expected one of ${allowed.join(', ')}`);
  }
}
