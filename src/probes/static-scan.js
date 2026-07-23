/**
 * Static source scan — parses HTML + CSS without opening a browser. This is the
 * probe that would have caught the two visual killers from the incident that
 * inspired vigia:
 *
 *   1. heavy filter: blur() glows  → GPU-memory blowup on iOS Retina (heuristic)
 *   2. backdrop-filter without -webkit- prefix → silently no-ops on Safari ≤17 (verdict)
 *
 * Plus the #1 responsive killer that's decidable statically: a missing/broken
 * <meta name="viewport">.
 *
 * Sources: WebKit blog (backdrop-filter cost & prefix), web.dev (paint/layers),
 * MDN (viewport meta).
 */

import { SEVERITY, STATUS, TYPE, CONFIDENCE } from '../core/finding.js';

const BIG_BLUR_PX = 50; // web.dev: blur > ~50px on a large element is a mobile red flag

export default {
  id: 'static',
  title: 'Static HTML/CSS scan (GPU-blur, WebKit prefixes, viewport)',
  appliesTo: () => true, // works for both url and dir targets

  async run(ctx) {
    const findings = [];
    const { html, css, sources } = await gather(ctx);

    viewportMeta(html, findings);
    backdropPrefix(css, sources, findings);
    heavyBlur(css, sources, findings);

    return findings;
  },
};

// ---------------------------------------------------------------------------

async function gather(ctx) {
  if (ctx.target.type === 'url') {
    const page = await ctx.http(ctx.target.url);
    const html = page.body || '';
    const cssChunks = [];
    const sources = [];

    // inline <style> blocks
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      cssChunks.push(m[1]);
      sources.push('inline <style>');
    }
    // linked stylesheets
    const links = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
      .map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1])
      .filter(Boolean)
      .slice(0, 20); // sanity cap
    for (const href of links) {
      try {
        const abs = new URL(href, ctx.target.url).href;
        const r = await ctx.http(abs);
        cssChunks.push(r.body || '');
        sources.push(abs);
      } catch {
        /* skip unfetchable stylesheet */
      }
    }
    return { html, css: cssChunks, sources };
  }

  // directory target: read the built files
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const files = await walk(ctx.target.dir, readdir, path);
  let html = '';
  const css = [];
  const sources = [];
  for (const f of files) {
    if (/\.html?$/i.test(f)) {
      const content = await readFile(f, 'utf8').catch(() => '');
      html += '\n' + content;
      // inline <style> blocks count as CSS too
      for (const m of content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        css.push(m[1]);
        sources.push(`${f} (inline <style>)`);
      }
    } else if (/\.css$/i.test(f)) {
      css.push(await readFile(f, 'utf8').catch(() => ''));
      sources.push(f);
    }
  }
  return { html, css, sources };
}

async function walk(dir, readdir, path, acc = [], depth = 0) {
  if (depth > 6) return acc;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, readdir, path, acc, depth + 1);
    else acc.push(full);
  }
  return acc;
}

// ---------------------------------------------------------------------------

function viewportMeta(html, findings) {
  const m = /<meta[^>]+name=["']?viewport["']?[^>]*>/i.exec(html);
  if (!m) {
    findings.push({
      id: 'static/viewport-meta',
      title: 'Missing <meta name="viewport">',
      status: STATUS.FAIL,
      severity: SEVERITY.CRITICAL,
      evidence: 'No viewport meta tag — mobile browsers render at ~980px and zoom out; media queries below 980px never fire.',
      remediation: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">`.',
      source: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport',
    });
    return;
  }
  const content = /content=["']([^"']+)["']/i.exec(m[0])?.[1] || '';
  if (!/width\s*=\s*device-width/i.test(content)) {
    findings.push({
      id: 'static/viewport-meta',
      title: 'viewport meta missing width=device-width',
      status: STATUS.FAIL,
      severity: SEVERITY.HIGH,
      evidence: `content="${content}"`,
      remediation: 'Use `width=device-width, initial-scale=1`.',
      source: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport',
    });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*[01]/i.test(content)) {
    findings.push({
      id: 'static/viewport-zoom',
      title: 'viewport blocks user zoom (accessibility failure)',
      status: STATUS.WARN,
      severity: SEVERITY.MEDIUM,
      evidence: `content="${content}"`,
      remediation: 'Remove `user-scalable=no` / `maximum-scale=1`; never disable pinch-zoom.',
      source: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    });
  } else {
    findings.push({ id: 'static/viewport-meta', title: 'viewport meta is correct', status: STATUS.PASS, severity: SEVERITY.INFO, evidence: `content="${content}"` });
  }
}

function backdropPrefix(cssChunks, sources, findings) {
  let unprefixed = 0;
  cssChunks.forEach((css, i) => {
    // find rule blocks using backdrop-filter without the -webkit- companion nearby
    for (const m of css.matchAll(/([^{}]*)\{([^{}]*backdrop-filter\s*:[^{}]*)\}/gi)) {
      const block = m[2];
      const hasStd = /(^|[^-])backdrop-filter\s*:/.test(block);
      const hasWebkit = /-webkit-backdrop-filter\s*:/.test(block);
      if (hasStd && !hasWebkit) {
        unprefixed++;
        findings.push({
          id: 'static/backdrop-filter-prefix',
          title: 'backdrop-filter without -webkit- prefix (no-ops on Safari ≤17)',
          status: STATUS.FAIL,
          severity: SEVERITY.MEDIUM,
          evidence: `Selector "${m[1].trim().slice(0, 60)}" uses backdrop-filter but not -webkit-backdrop-filter.`,
          affected: sources[i],
          remediation: 'Emit `-webkit-backdrop-filter` alongside `backdrop-filter`. Check your autoprefixer/browserslist.',
          source: 'https://caniuse.com/css-backdrop-filter',
        });
      }
    }
  });
}

function heavyBlur(cssChunks, sources, findings) {
  const hits = [];
  cssChunks.forEach((css, i) => {
    for (const m of css.matchAll(/filter\s*:\s*[^;{}]*blur\(\s*([\d.]+)px\s*\)/gi)) {
      const px = parseFloat(m[1]);
      if (px >= BIG_BLUR_PX) hits.push({ px, source: sources[i] });
    }
  });
  if (!hits.length) return;

  const maxPx = Math.max(...hits.map((h) => h.px));
  findings.push({
    id: 'static/gpu-blur-risk',
    title: `${hits.length} heavy filter: blur() glow(s) — GPU-memory risk on iOS Retina`,
    type: TYPE.HYPOTHESIS,
    confidence: CONFIDENCE.HEURISTIC,
    status: STATUS.WARN,
    severity: hits.length >= 4 || maxPx >= 120 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
    evidence:
      `Found ${hits.length} blur() ≥ ${BIG_BLUR_PX}px (largest ${maxPx}px). On a Retina iPhone each becomes an ` +
      `oversized GPU layer (~3× radius per side, ×4–9 for DPR); many at once can exhaust GPU memory → jank or a blank/crashed tab. ` +
      `Headless Linux WebKit runs on a virtual GPU and will NOT reproduce this — confirm on a physical device.`,
    remediation:
      'Replace big glows with `radial-gradient(closest-side, rgba(...), transparent)` (near-identical pixels, a fraction of the cost). ' +
      'If you must blur, cap it at ~14–20px on small elements and never animate the `filter` property.',
    source: 'https://web.dev/articles/simplify-paint-complexity-and-reduce-paint-areas',
  });
}
