import process from 'node:process';
import {
  getValue,
  logStep,
  parseArgs,
  prepareLocalProfile,
  printLocalProfileSummary,
  runStreamingCommand,
} from './lib.mjs';
import { runSmokeSuite } from './smoke.mjs';

const args = parseArgs(process.argv.slice(2));

const result = await prepareLocalProfile({
  envFile: getValue(args, '--env-file'),
  backupManagedEnv: args.flags.has('--backup-managed-env'),
  forceEnv: args.flags.has('--force-env'),
  recreateStack: !args.flags.has('--preserve-stack'),
  skipReset: args.flags.has('--skip-reset'),
  writeEnv: !args.flags.has('--no-write-env'),
});

printLocalProfileSummary(result);

logStep('Running repository quality checks');
await runStreamingCommand('pnpm', ['lint']);
await runStreamingCommand('pnpm', ['typecheck']);
await runStreamingCommand('pnpm', ['test']);

await runSmokeSuite({
  status: result.status,
  skipDbTests: args.flags.has('--skip-db-tests'),
  skipFunctionUnitTests: true,
  skipLiveChecks: args.flags.has('--skip-live-checks'),
});

process.exit(0);
