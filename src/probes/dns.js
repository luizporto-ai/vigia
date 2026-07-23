/**
 * DNS / reachability probe. This is where vigia is most careful about honesty.
 *
 * The "works in Chrome, blank in Safari on iPhone" failure (iCloud Private Relay
 * resolving DNS over an Oblivious-DoH path independent of the OS resolver, made
 * worse by a recent NS-delegation change) lives entirely on the CLIENT network
 * path. No server-side scanner can reproduce or prove it.
 *
 * So we do the one honest thing available: report delegation health as evidence,
 * and always attach the runbook as a HYPOTHESIS — never a verdict.
 *
 * Sources: Apple "Prepare your network for iCloud Private Relay", Cloudflare ODoH.
 */

import { SEVERITY, STATUS, TYPE, CONFIDENCE } from '../core/finding.js';

export default {
  id: 'dns',
  title: 'DNS delegation health & Safari/Private-Relay runbook',
  appliesTo: (target) => target.type === 'url',

  async run(ctx) {
    const findings = [];
    const host = new URL(ctx.target.url).hostname;
    const dns = await import('node:dns/promises');

    let ns = [];
    let a = [];
    try {
      ns = await dns.resolveNs(apex(host)).catch(() => []);
    } catch {
      /* ignore */
    }
    try {
      a = await dns.resolve4(host).catch(() => []);
    } catch {
      /* ignore */
    }

    // Evidence-only: authoritative nameservers and A records.
    findings.push({
      id: 'dns/delegation',
      title: 'DNS delegation snapshot',
      status: STATUS.INFO,
      severity: SEVERITY.INFO,
      evidence:
        `apex ${apex(host)} NS: ${ns.length ? ns.join(', ') : '(none resolved)'} · ` +
        `${host} A: ${a.length ? a.join(', ') : '(none resolved)'}`,
      remediation:
        'Keep parent and child NS records consistent. After changing delegation, lower TTL first and ' +
        'validate on a real iPhone with Private Relay ON before assuming it propagated.',
      source: 'https://developer.apple.com/icloud/prepare-your-network-for-icloud-private-relay/',
    });

    // The always-attached honest hypothesis + runbook.
    findings.push({
      id: 'dns/private-relay-runbook',
      title: 'If the site loads in Chrome but not in Safari on iPhone — investigate Private Relay',
      type: TYPE.HYPOTHESIS,
      confidence: CONFIDENCE.NEEDS_DEVICE,
      status: STATUS.INFO,
      severity: SEVERITY.INFO,
      evidence:
        'Safari with iCloud Private Relay resolves DNS via Oblivious-DoH through Apple relays — a different path ' +
        'than the OS resolver Chrome uses. A recent/stale NS-delegation change can make Safari fail while Chrome ' +
        'succeeds on the same device. A server-side scan CANNOT prove this; it can only surface the hypothesis.',
      remediation: [
        'Runbook (in order):',
        '1. Read the ACCESS LOG first — did the Safari request even arrive? Zero hits ⇒ the problem is before your server (DNS/relay), not your CSS/HTML.',
        '2. `dig +trace <domain>` and compare parent-zone NS vs the child authoritative NS set (catch stale delegation).',
        '3. On the affected iPhone: Settings › Apple ID › iCloud › Private Relay → toggle OFF, retest (A/B of one variable).',
        '4. Cross-check the access log against Apple egress IPs: https://mask-api.icloud.com/egress-ip-ranges.csv',
      ].join('\n'),
      source: 'https://developers.cloudflare.com/1.1.1.1/encryption/oblivious-dns-over-https/',
    });

    return findings;
  },
};

function apex(host) {
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : host;
}
