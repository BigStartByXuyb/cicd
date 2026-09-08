import fs from 'node:fs';
import { parseAuditReport } from './lib/audit-report.mjs';

const reportPath = process.argv[process.argv.indexOf('--input') + 1];
if (!reportPath) throw new Error('--input is required');
const result = parseAuditReport(fs.readFileSync(reportPath, 'utf8'));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.result === 'BLOCK' || result.result === 'INVALID') process.exitCode = 1;
