/**
 * Probe registry. Add a check = add a module here. Each probe is:
 *   { id, title, appliesTo(target) => bool, async run(ctx) => Finding[] }
 */

import headers from './headers.js';
import staticScan from './static-scan.js';
import dns from './dns.js';
import render from './render.js';
import perf from './perf.js';

export const PROBES = [headers, staticScan, dns, render, perf];
