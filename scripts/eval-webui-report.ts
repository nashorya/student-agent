import { writeEvalWebuiReport } from '../src/evals/webui-report.js';

async function main(): Promise<void> {
  const outputPath = await writeEvalWebuiReport();
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    open: 'python3 -m http.server 4173',
    url: 'http://localhost:4173/evals/webui/',
  }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
