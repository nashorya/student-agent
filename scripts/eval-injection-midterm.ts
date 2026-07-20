import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildInjectionMidtermReport } from '../src/evals/injection-midterm.js';

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  buildInjectionMidtermReport({
    resultsDir: resolve(option(args, '--results-dir')),
    familyId: option(args, '--family'),
  }).then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
