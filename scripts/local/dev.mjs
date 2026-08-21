import { spawn } from 'node:child_process';
import {
  getValue,
  parseArgs,
  prepareLocalProfile,
  printLocalProfileSummary,
  repoRoot,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));

const result = await prepareLocalProfile({
  envFile: getValue(args, '--env-file'),
  backupManagedEnv: args.flags.has('--backup-managed-env'),
  forceEnv: args.flags.has('--force-env'),
  skipReset: true,
  writeEnv: !args.flags.has('--no-write-env'),
});

printLocalProfileSummary(result);

const child = spawn('pnpm', ['dev'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
