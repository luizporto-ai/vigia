/**
 * Render probe — drives real browser engines via Playwright:
 *   chromium  → full responsive sweep + smoke (console/errors/404/broken imgs) + a11y
 *   webkit    → the engine behind Safari: overflow + smoke, to catch WebKit-only breakage
 *   firefox   → smoke, a cheap third opinion
 *
 * Honesty note baked into findings: Playwright's WebKit is upstream WebKit on a
 * virtual GPU — great for layout/DOM/JS/prefixes, but it is NOT branded Safari and
 * cannot reproduce GPU-memory crashes, CoreText fonts, Private Relay, or Low Power
 * Mode. Those stay in the `static` (heuristic) and `dns` (hypothesis) probes.
 *
 * Sources: Playwright docs (WebKit vs Safari), MDN scrollWidth, W3C WCAG 2.5.
 */

import { SEVERITY, STATUS } from '../core/finding.js';
import { serveDir } from '../core/serve.js';

const ENGINES = ['chromium', 'webkit', 'firefox'];

export default {
  id: 'render',
  title: 'Cross-browser render, responsiveness & smoke (Playwright)',
  appliesTo: () => true,

  async run(ctx) {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      return [
        {
          id: 'render/not-installed',
          title: 'Render probe skipped — Playwright not installed',
          status: STATUS.INFO,
          severity: SEVERITY.INFO,
          evidence: 'The cross-browser render/smoke/a11y checks need Playwright.',
          remediation: 'Install it once: `npm i -D playwright && npx playwright install`. Then re-run vigia.',
          source: 'https://playwright.dev/docs/browsers',
        },
      ];
    }

    // Resolve a URL to load — serve the directory if the target is local.
    let baseUrl = ctx.target.url;
    let server = null;
    if (ctx.target.type === 'dir') {
      server = await serveDir(ctx.target.dir);
      baseUrl = server.url;
    }

    const findings = [];
    try {
      for (const engine of ENGINES) {
        await runEngine(playwright, engine, baseUrl, ctx, findings);
      }
    } finally {
      if (server) await server.close();
    }
    return findings;
  },
};

async function runEngine(playwright, engine, url, ctx, findings) {
  let browser;
  try {
    browser = await playwright[engine].launch();
  } catch (err) {
    findings.push({
      id: `render/${engine}-unavailable`,
      title: `${engine} browser not available`,
      status: STATUS.INFO,
      severity: SEVERITY.INFO,
      evidence: err.message,
      remediation: `Install the engine: \`npx playwright install ${engine}\`.`,
      source: 'https://playwright.dev/docs/browsers',
    });
    return;
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Attach listeners BEFORE navigation — events during load are missed otherwise.
    const consoleErrors = [];
    const pageErrors = [];
    const badResponses = [];
    const failedRequests = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push({ url: r.url(), status: r.status(), type: r.request().resourceType() });
    });
    page.on('requestfailed', (r) => {
      const f = r.failure();
      if (f && !/ERR_ABORTED/.test(f.errorText)) failedRequests.push({ url: r.url(), error: f.errorText });
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch((e) => {
      findings.push({
        id: `render/${engine}-load-failed`,
        title: `${engine}: page failed to load`,
        status: STATUS.FAIL,
        severity: SEVERITY.CRITICAL,
        evidence: e.message,
        remediation: 'The page did not reach `load`. Check the URL is reachable and does not hang.',
        source: 'https://playwright.dev/docs/api/class-page#page-goto',
      });
    });

    // Smoke checks (once per engine, at a desktop viewport).
    await page.setViewportSize({ width: 1280, height: 800 });
    reportSmoke(engine, { consoleErrors, pageErrors, badResponses, failedRequests }, findings);
    await brokenImages(engine, page, findings);

    // Responsive sweep — full on chromium, mobile+desktop on webkit, skip on firefox.
    const viewports =
      engine === 'chromium' ? ctx.viewports : engine === 'webkit' ? ctx.viewports.filter((v) => v.width <= 430 || v.width >= 1280) : [];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(120);
      await overflowCheck(engine, page, vp, findings);
    }

    // Accessibility + tap targets — chromium only, at a phone viewport.
    if (engine === 'chromium') {
      await page.setViewportSize({ width: 390, height: 844 });
      await tapTargets(page, findings);
      await axeScan(page, findings);
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

function reportSmoke(engine, { consoleErrors, pageErrors, badResponses, failedRequests }, findings) {
  if (pageErrors.length) {
    findings.push({
      id: 'render/js-errors',
      title: `${engine}: uncaught JavaScript error(s)`,
      status: STATUS.FAIL,
      severity: SEVERITY.HIGH,
      evidence: dedupe(pageErrors).slice(0, 5).join(' | '),
      affected: engine,
      remediation: 'An early uncaught throw can halt all subsequent init (dead buttons, half-rendered UI). Fix the root exception.',
      source: 'https://playwright.dev/docs/api/class-page#page-event-page-error',
    });
  }
  const assetErrors = badResponses.filter((r) => ['script', 'stylesheet', 'font', 'image', 'document'].includes(r.type));
  if (assetErrors.length) {
    const crit = assetErrors.some((r) => ['script', 'stylesheet', 'document'].includes(r.type));
    findings.push({
      id: 'render/failed-assets',
      title: `${engine}: ${assetErrors.length} sub-resource(s) returned 4xx/5xx`,
      status: STATUS.FAIL,
      severity: crit ? SEVERITY.CRITICAL : SEVERITY.HIGH,
      evidence: assetErrors.slice(0, 6).map((r) => `${r.status} ${r.type} ${short(r.url)}`).join(' | '),
      affected: engine,
      remediation:
        'A referenced asset is missing. This is the classic "white screen after deploy" (cached HTML points at a hashed ' +
        'chunk your deploy deleted). Deploy atomically and never `rsync --delete` old hashed assets still referenced by live HTML.',
      source: 'https://vite.dev/guide/build.html',
    });
  }
  if (failedRequests.length) {
    findings.push({
      id: 'render/failed-requests',
      title: `${engine}: ${failedRequests.length} request(s) failed at transport`,
      status: STATUS.WARN,
      severity: SEVERITY.MEDIUM,
      evidence: failedRequests.slice(0, 5).map((r) => `${short(r.url)} (${r.error})`).join(' | '),
      affected: engine,
      remediation: 'DNS failure, connection refused, blocked, or CORS. Check the origin and mixed-content.',
      source: 'https://playwright.dev/docs/api/class-page#page-event-request-failed',
    });
  }
  if (consoleErrors.length) {
    findings.push({
      id: 'render/console-errors',
      title: `${engine}: ${consoleErrors.length} console error(s)`,
      status: STATUS.WARN,
      severity: SEVERITY.LOW,
      evidence: dedupe(consoleErrors).slice(0, 5).join(' | '),
      affected: engine,
      remediation: 'Triage: fix app-origin errors; suppress known third-party noise rather than muting the channel.',
      source: 'https://playwright.dev/docs/api/class-consolemessage',
    });
  }
}

async function overflowCheck(engine, page, vp, findings) {
  const result = await page.evaluate(() => {
    const de = document.documentElement;
    const docW = de.clientWidth;
    if (de.scrollWidth <= docW + 1) return null;
    const culprits = [];
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetParent === null && el !== document.body) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
      const r = el.getBoundingClientRect();
      if (r.right > docW + 1 && r.width > 0) {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
        culprits.push(`${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 80));
        if (culprits.length >= 5) break;
      }
    }
    return { overflow: de.scrollWidth - docW, culprits };
  });
  if (result) {
    findings.push({
      id: 'render/horizontal-overflow',
      title: `${engine} @ ${vp.width}px: horizontal overflow (${result.overflow}px)`,
      status: STATUS.FAIL,
      severity: SEVERITY.HIGH,
      evidence: `Page scrolls sideways at ${vp.name} (${vp.width}px). Likely culprits: ${result.culprits.join(', ') || '(none isolated)'}`,
      affected: `${engine} @ ${vp.width}px`,
      remediation:
        'Fix the culprit (fixed px width, image without max-width:100%, flex item without min-width:0, grid track without minmax(0,…), ' +
        'or an unbreakable string). Do NOT just hide it with `overflow-x:hidden` on body.',
      source: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollWidth',
    });
  }
}

async function brokenImages(engine, page, findings) {
  const broken = await page
    .evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src)
        .slice(0, 8)
    )
    .catch(() => []);
  if (broken.length) {
    findings.push({
      id: 'render/broken-images',
      title: `${engine}: ${broken.length} broken image(s)`,
      status: STATUS.WARN,
      severity: SEVERITY.MEDIUM,
      evidence: broken.map(short).join(' | '),
      affected: engine,
      remediation: 'Fix the src/deploy; add width/height and a fallback.',
      source: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/naturalWidth',
    });
  }
}

async function tapTargets(page, findings) {
  const small = await page
    .evaluate(() => {
      const sel = 'a,button,input,select,textarea,[role=button],[onclick]';
      const out = [];
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.width < 24 || r.height < 24) {
          out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        if (out.length >= 8) break;
      }
      return out;
    })
    .catch(() => []);
  if (small.length) {
    findings.push({
      id: 'render/tap-targets',
      title: `${small.length} tap target(s) below the 24×24px minimum`,
      status: STATUS.WARN,
      severity: SEVERITY.MEDIUM,
      evidence: small.join(' | '),
      remediation: 'Give interactive elements a ≥44×44px hit area (padding/min-height) with ≥24px spacing. WCAG 2.5.8 (AA) is 24px; Apple HIG / AAA is 44px.',
      source: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
    });
  }
}

async function axeScan(page, findings) {
  let AxeBuilder;
  try {
    ({ default: AxeBuilder } = await import('@axe-core/playwright'));
  } catch {
    return; // axe is optional; silently skip
  }
  try {
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    if (serious.length) {
      findings.push({
        id: 'render/a11y',
        title: `${serious.length} serious/critical accessibility issue(s)`,
        status: STATUS.WARN,
        severity: SEVERITY.MEDIUM,
        evidence: serious.slice(0, 6).map((v) => `${v.id} (${v.nodes.length}×)`).join(' | '),
        remediation:
          'Fix the axe rules listed (e.g. image-alt, label, button-name, color-contrast). Note: axe finds ~57% of WCAG issues automatically — a clean pass is not full conformance.',
        source: 'https://github.com/dequelabs/axe-core',
      });
    }
  } catch {
    /* axe can throw on exotic pages; ignore */
  }
}

const short = (u) => (u.length > 70 ? u.slice(0, 67) + '…' : u);
const dedupe = (arr) => [...new Set(arr)];
