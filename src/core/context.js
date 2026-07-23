/**
 * Audit context — everything a probe needs to do its job, and nothing more.
 * Probes receive this and return an array of findings. Keeping the shared
 * surface small keeps probes isolated and testable.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_VIEWPORTS = [
  { name: 'phone-small', width: 360, height: 800 }, // #1 global mobile viewport (Galaxy A/S)
  { name: 'phone', width: 390, height: 844 }, // iPhone 14/15/16
  { name: 'phone-max', width: 430, height: 932 }, // iPhone Pro Max
  { name: 'tablet', width: 768, height: 1024 }, // iPad portrait
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
];

/**
 * @param {{type:'url'|'dir', url?:string, dir?:string}} target
 * @param {object} options
 */
export function createContext(target, options = {}) {
  const cache = new Map();

  return {
    target,
    options,
    viewports: options.viewports || DEFAULT_VIEWPORTS,

    /**
     * Fetch a URL once, cached for the run. Returns status, headers (lowercased),
     * final URL after redirects, redirect chain, and body text.
     */
    async http(url, { method = 'GET', headers = {}, redirect = 'follow' } = {}) {
      const key = `${method} ${url} ${redirect}`;
      if (cache.has(key)) return cache.get(key);
      const promise = doFetch(url, { method, headers, redirect });
      cache.set(key, promise);
      return promise;
    },

    /** Read a file from a local build directory target. */
    async readLocal(relPath) {
      if (target.type !== 'dir') throw new Error('readLocal only valid for directory targets');
      return readFile(path.join(target.dir, relPath), 'utf8');
    },
  };
}

async function doFetch(url, { method, headers, redirect }) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    redirect,
    headers: { 'user-agent': 'vigia/0.1 (+https://github.com/luizporto-ai/vigia)', ...headers },
  });
  const body = method === 'HEAD' ? '' : await res.text().catch(() => '');
  const h = {};
  for (const [k, v] of res.headers.entries()) h[k.toLowerCase()] = v;
  return {
    ok: res.ok,
    status: res.status,
    url: res.url,
    redirected: res.redirected,
    headers: h,
    body,
    elapsedMs: Date.now() - started,
  };
}
