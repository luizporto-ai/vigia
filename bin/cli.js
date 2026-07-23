#!/usr/bin/env node
/**
 * vigia CLI.  `vigia <url|dir> [flags]`
 */

import { writeFile } from 'node:fs/promises';
import { runAudit } from '../src/core/engine.js';
import { renderTerminal } from '../src/report/terminal.js';
import { renderMarkdown } from '../src/report/markdown.js';

const HELP = `
vigia — your lookout for what breaks before users do

Usage:
  vigia <url|dir> [options]

Examples:
  vigia https://your-site.com
  vigia ./dist
  vigia https://your-site.com --json report.json --md report.md
  vigia ./dist --only headers,static --ci

Options:
  --json [file]      Write JSON report (to file, or stdout if no file)
  --md <file>        Write a Markdown report
  --only <ids>       Run only these probes (comma-sep: headers,static,dns,render,perf)
  --skip <ids>       Skip these probes
  --ci               Exit non-zero if any critical/high verdict fails
  -h, --help         Show this help
`;

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    process.stdout.write(HELP);
    process.exit(args.length ? 0 : 1);
  }

  const opts = { target: null, json: undefined, md: undefined, only: undefined, skip: undefined, ci: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = next(args, i) && !args[i + 1].startsWith('-') ? args[++i] : true;
    else if (a === '--md') opts.md = args[++i];
    else if (a === '--only') opts.only = args[++i]?.split(',').map((s) => s.trim());
    else if (a === '--skip') opts.skip = args[++i]?.split(',').map((s) => s.trim());
    else if (a === '--ci') opts.ci = true;
    else if (!a.startsWith('-')) opts.target = a;
  }

  if (!opts.target) {
    process.stderr.write('error: no target given.\n' + HELP);
    process.exit(1);
  }

  let report;
  try {
    report = await runAudit(opts.target, { only: opts.only, skip: opts.skip });
  } catch (err) {
    process.stderr.write(`\nerror: ${err.message}\n\n`);
    process.exit(1);
  }

  // Terminal output unless JSON is going to stdout.
  if (opts.json !== true) process.stdout.write(renderTerminal(report));

  if (opts.json) {
    const jsonStr = JSON.stringify(report, null, 2);
    if (opts.json === true) process.stdout.write(jsonStr + '\n');
    else await writeFile(opts.json, jsonStr);
  }
  if (opts.md) await writeFile(opts.md, renderMarkdown(report));

  if (opts.ci && !report.summary.ciPass) process.exit(1);
  process.exit(0);
}

function next(args, i) {
  return i + 1 < args.length;
}

main();
