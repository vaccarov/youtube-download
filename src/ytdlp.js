import { spawn } from 'node:child_process';
import { ICON } from './terminal.js';

let activeChild = null;
let interrupted = false;

/** True once Ctrl+C was forwarded to yt-dlp, so the run stops after the current link. */
export function wasInterrupted() {
  return interrupted;
}

/** The signal is forwarded so yt-dlp can leave resumable .part files behind. */
process.on('SIGINT', () => {
  if (activeChild && !interrupted) {
    interrupted = true;
    activeChild.kill('SIGINT');
    return;
  }
  console.log(`\n${ICON.warn} Interrupted.`);
  process.exit(130);
});

function lineReader(onLine) {
  let pending = '';
  return {
    push(chunk) {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    },
    flush() {
      if (pending) onLine(pending);
      pending = '';
    },
  };
}

/** Only `ytDlpPath` and `verbose` are read here, so setup can call in with a partial context. */
function spawnYtDlp(context, args) {
  if (context.verbose) {
    console.log(`$ ${context.ytDlpPath} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`);
  }
  const child = spawn(context.ytDlpPath, args, { windowsHide: true });
  activeChild = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

/** Buffers both streams, for the calls whose whole output is the result (-J, --print, -F). */
function captureYtDlp(context, args) {
  return new Promise((resolve, reject) => {
    const child = spawnYtDlp(context, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      activeChild = null;
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Reports line by line as they come. Download progress goes to stdout while
 * postprocessor progress goes to stderr, so both streams feed the same handler.
 */
export function streamYtDlp(context, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawnYtDlp(context, args);
    const [out, err] = [lineReader(onLine), lineReader(onLine)];
    let stderr = '';

    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      err.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      activeChild = null;
      out.flush();
      err.flush();
      resolve({ code, stderr });
    });
  });
}

export function warningsOf(stderr) {
  return stderr.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('WARNING:'));
}

export function firstError(stderr) {
  return stderr.split('\n').find((line) => line.startsWith('ERROR:'))?.replace(/^ERROR:\s*/, '').trim();
}

export async function captureOrThrow(context, args) {
  const { code, stdout, stderr } = await captureYtDlp(context, args);
  // A process killed by a signal exits non-zero without printing an ERROR line.
  if (code !== 0) throw new Error(firstError(stderr) ?? `yt-dlp exited with code ${code}`);
  return { stdout, stderr };
}
