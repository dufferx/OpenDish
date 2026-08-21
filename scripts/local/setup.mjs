import {
  getValue,
  parseArgs,
  prepareLocalProfile,
  printLocalProfileSummary,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

const result = await prepareLocalProfile({
  envFile: getValue(args, '--env-file'),
  backupManagedEnv: args.flags.has('--backup-managed-env'),
  forceEnv: args.flags.has('--force-env'),
  skipReset: args.flags.has('--skip-reset'),
  writeEnv: !args.flags.has('--no-write-env'),
});

printLocalProfileSummary(result);
