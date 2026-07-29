import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildInjectionFamilyReadout,
  buildInjectionReadout,
} from '../src/evals/injection-midterm.js';

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const resultsDir = resolve(option(args, '--results-dir'));
  // `--families a,b,c` builds the cross-family readout; `--family x` a single one.
  const families = optional(args, '--families');
  const report = families
    ? buildInjectionReadout({ resultsDir, familyIds: families.split(',').map((id) => id.trim()).filter(Boolean) })
    : buildInjectionFamilyReadout({ resultsDir, familyId: option(args, '--family') });
  report.then((value) => console.log(JSON.stringify(value, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
}
