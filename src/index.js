/**
 * Public API. `import { runAudit } from 'vigia'`.
 */

export { runAudit, resolveTarget } from './core/engine.js';
export { finding, SEVERITY, STATUS, TYPE, CONFIDENCE, sortFindings } from './core/finding.js';
export { renderTerminal } from './report/terminal.js';
export { renderMarkdown } from './report/markdown.js';
export { PROBES } from './probes/index.js';
