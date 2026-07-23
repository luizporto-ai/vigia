/**
 * Delivery-layer probe — the highest-signal, cheapest checks. One request and a
 * read of the response headers catches compression, caching, security, and
 * canonicalization mistakes. All deterministic verdicts.
 *
 * Sources: MDN HTTP headers, RFC 9111 (caching), OWASP Secure Headers.
 */

import { SEVERITY, STATUS } from '../core/finding.js';

export default {
  id: 'headers',
  title: 'HTTP delivery & security headers',
  appliesTo: (target) => target.type === 'url',

  async run(ctx) {
    const findings = [];
    const res = await ctx.http(ctx.target.url);
    const h = res.headers;

    // ---- Compression ------------------------------------------------------
    const enc = h['content-encoding'];
    if (enc && /\b(br|gzip|zstd|deflate)\b/.test(enc)) {
      findings.push(ok('headers/compression', 'Text compression enabled', `content-encoding: ${enc}`));
    } else {
      findings.push({
        id: 'headers/compression',
        title: 'No text compression on the HTML document',
        status: STATUS.FAIL,
        severity: SEVERITY.HIGH,
        evidence: `Response has no compressing content-encoding header (got: ${enc || 'none'}).`,
        remediation:
          'Enable brotli (preferred) or gzip for text MIME types at the server/CDN edge. ' +
          'Always send `Vary: Accept-Encoding` so shared caches key by encoding.',
        source: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding',
      });
    }

    // ---- Cache-Control on HTML -------------------------------------------
    const cc = h['cache-control'];
    if (!cc) {
      findings.push({
        id: 'headers/html-cache-control',
        title: 'HTML has no explicit Cache-Control (heuristic caching risk)',
        status: STATUS.WARN,
        severity: SEVERITY.MEDIUM,
        evidence: 'No Cache-Control header — caches may guess a lifetime from Last-Modified (~10% rule).',
        remediation: 'Send `Cache-Control: no-cache` on HTML so it always revalidates before reuse.',
        source: 'https://www.rfc-editor.org/rfc/rfc9111.html#section-4.2.2',
      });
    } else if (maxAgeOf(cc) > 3600 && !/no-cache/.test(cc)) {
      findings.push({
        id: 'headers/html-cache-control',
        title: 'HTML served with a long max-age (stale-after-deploy risk)',
        status: STATUS.WARN,
        severity: SEVERITY.MEDIUM,
        evidence: `cache-control: ${cc} — cached HTML can keep pointing at old hashed assets after a deploy.`,
        remediation: 'Use `Cache-Control: no-cache` for HTML entry documents; reserve long/immutable TTLs for hashed assets.',
        source: 'https://vite.dev/guide/build.html',
      });
    } else {
      findings.push(ok('headers/html-cache-control', 'HTML Cache-Control is sane', `cache-control: ${cc}`));
    }

    // ---- Security headers -------------------------------------------------
    security(h, findings);

    // ---- HTTP -> HTTPS redirect ------------------------------------------
    await httpsRedirect(ctx, findings);

    // ---- Fingerprinting headers ------------------------------------------
    const leaks = ['server', 'x-powered-by', 'x-aspnet-version'].filter((k) => h[k]);
    if (leaks.length) {
      findings.push({
        id: 'headers/fingerprinting',
        title: 'Server advertises software/version headers',
        status: STATUS.WARN,
        severity: SEVERITY.LOW,
        evidence: leaks.map((k) => `${k}: ${h[k]}`).join(' · '),
        remediation: 'Remove Server/X-Powered-By/X-AspNet-Version to reduce fingerprinting surface.',
        source: 'https://owasp.org/www-project-secure-headers/',
      });
    }

    return findings;
  },
};

function security(h, findings) {
  const checks = [
    {
      id: 'headers/hsts',
      key: 'strict-transport-security',
      title: 'HSTS (Strict-Transport-Security)',
      severity: SEVERITY.HIGH,
      fix: 'Add `Strict-Transport-Security: max-age=63072000; includeSubDomains` on HTTPS responses.',
      src: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security',
      valid: (v) => /max-age=\d+/.test(v),
    },
    {
      id: 'headers/csp',
      key: 'content-security-policy',
      title: 'Content-Security-Policy',
      severity: SEVERITY.HIGH,
      fix: "Add a CSP (at minimum `default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`).",
      src: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP',
    },
    {
      id: 'headers/x-content-type-options',
      key: 'x-content-type-options',
      title: 'X-Content-Type-Options',
      severity: SEVERITY.MEDIUM,
      fix: 'Add `X-Content-Type-Options: nosniff`.',
      src: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options',
      valid: (v) => /nosniff/.test(v),
    },
    {
      id: 'headers/referrer-policy',
      key: 'referrer-policy',
      title: 'Referrer-Policy',
      severity: SEVERITY.LOW,
      fix: 'Add `Referrer-Policy: strict-origin-when-cross-origin`.',
      src: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy',
    },
  ];

  for (const c of checks) {
    const v = h[c.key];
    const present = v != null && (!c.valid || c.valid(v));
    if (present) {
      findings.push(ok(c.id, `${c.title} present`, `${c.key}: ${v}`));
    } else {
      findings.push({
        id: c.id,
        title: `Missing/weak ${c.title}`,
        status: STATUS.FAIL,
        severity: c.severity,
        evidence: v == null ? `Header "${c.key}" absent.` : `Header present but weak: ${v}`,
        remediation: c.fix,
        source: c.src,
      });
    }
  }

  // Clickjacking: XFO or CSP frame-ancestors satisfies it.
  const framed = h['x-frame-options'] || /frame-ancestors/.test(h['content-security-policy'] || '');
  if (framed) {
    findings.push(ok('headers/clickjacking', 'Clickjacking protection present', h['x-frame-options'] || 'CSP frame-ancestors'));
  } else {
    findings.push({
      id: 'headers/clickjacking',
      title: 'No clickjacking protection',
      status: STATUS.FAIL,
      severity: SEVERITY.MEDIUM,
      evidence: 'Neither X-Frame-Options nor CSP frame-ancestors is set.',
      remediation: "Add `Content-Security-Policy: frame-ancestors 'none'` (preferred) or `X-Frame-Options: DENY`.",
      source: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options',
    });
  }
}

async function httpsRedirect(ctx, findings) {
  const u = new URL(ctx.target.url);
  if (u.protocol !== 'https:') return; // only meaningful when the site is https
  const httpUrl = `http://${u.host}${u.pathname}`;
  try {
    const res = await ctx.http(httpUrl, { redirect: 'manual' });
    if ([301, 308, 302, 307].includes(res.status) && /^https:/.test(res.headers.location || '')) {
      findings.push(ok('headers/https-redirect', 'HTTP redirects to HTTPS', `${res.status} → ${res.headers.location}`));
    } else {
      findings.push({
        id: 'headers/https-redirect',
        title: 'HTTP does not redirect to HTTPS',
        status: STATUS.FAIL,
        severity: SEVERITY.HIGH,
        evidence: `http:// returned ${res.status} (location: ${res.headers.location || 'none'}).`,
        remediation: 'Return `301` to the https:// URL for all plain-HTTP requests; then HSTS locks it in.',
        source: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security',
      });
    }
  } catch {
    // http not reachable — not necessarily a problem; skip silently.
  }
}

function ok(id, title, evidence) {
  return { id, title, status: STATUS.PASS, severity: SEVERITY.INFO, evidence };
}

function maxAgeOf(cacheControl) {
  const m = /max-age=(\d+)/.exec(cacheControl || '');
  return m ? Number(m[1]) : -1;
}
