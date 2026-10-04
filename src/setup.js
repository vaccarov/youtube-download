import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BINARY_MAX_AGE_DAYS, CONFIG, RELEASE_ASSETS, RELEASE_BASE_URL } from './config.js';
import { ICON } from './terminal.js';
import { captureOrThrow } from './ytdlp.js';

// -----------------------------------------------------------------------------
// Platform
// -----------------------------------------------------------------------------

function isMuslLinux() {
  return os.platform() === 'linux' && !process.report.getReport().header.glibcVersionRuntime;
}

/** The single point where an unsupported platform is rejected. */
function releaseAssetName() {
  const [platform, arch] = [os.platform(), os.arch()];
  const asset = RELEASE_ASSETS[platform]?.[arch];
  if (!asset) {
    throw new Error(`No yt-dlp build for ${platform}/${arch}. Install it and set YTDLP_PATH.`);
  }
  return isMuslLinux() ? asset.replace('yt-dlp_linux', 'yt-dlp_musllinux') : asset;
}

// -----------------------------------------------------------------------------
// yt-dlp binary
// -----------------------------------------------------------------------------

async function expectedChecksum(assetName) {
  const response = await fetch(`${RELEASE_BASE_URL}/SHA2-256SUMS`);
  if (!response.ok) throw new Error(`SHA2-256SUMS: HTTP ${response.status}`);
  const entry = (await response.text())
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === assetName);
  if (!entry) throw new Error(`No published checksum for ${assetName}`);
  return entry[0];
}

async function downloadBinary(ytDlpPath) {
  const assetName = releaseAssetName();
  console.log(`${ICON.box} Downloading ${assetName} (first run only)...`);
  fs.mkdirSync(path.dirname(ytDlpPath), { recursive: true });

  const checksum = await expectedChecksum(assetName);
  const response = await fetch(`${RELEASE_BASE_URL}/${assetName}`);
  if (!response.ok) throw new Error(`${assetName}: HTTP ${response.status}`);

  // Verification happens before anything is written, so a mismatch cannot leave
  // a bad binary behind. The temp name only guards against a crash mid-write.
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== checksum) {
    throw new Error(`Checksum mismatch for ${assetName}: expected ${checksum}, got ${digest}`);
  }

  const tempPath = `${ytDlpPath}.download`;
  fs.writeFileSync(tempPath, bytes);
  fs.renameSync(tempPath, ytDlpPath);
  if (os.platform() !== 'win32') fs.chmodSync(ytDlpPath, 0o755);
  console.log(`${ICON.ok} yt-dlp installed, SHA-256 verified.`);
}

async function updateBinary(context) {
  console.log(`${ICON.tool} Checking for a newer yt-dlp...`);
  const { stdout } = await captureOrThrow(context, ['--ignore-config', '-U']);
  console.log(`${ICON.ok} ${stdout.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)}`);
  // Refresh mtime so the age check does not run again tomorrow.
  fs.utimesSync(context.ytDlpPath, new Date(), new Date());
}

/**
 * Resolves where the binary lives, validating the platform on the way. Kept
 * separate from the rest of the environment so --update needs nothing else.
 */
export function resolveYtDlpPath() {
  return CONFIG.ytDlpOverride ?? path.join(CONFIG.binDir, releaseAssetName());
}

export async function ensureBinary(context, { forceUpdate = false, skipUpdate = false } = {}) {
  if (!fs.existsSync(context.ytDlpPath)) {
    await downloadBinary(context.ytDlpPath);
    return;
  }
  if (forceUpdate) {
    await updateBinary(context);
    return;
  }
  if (skipUpdate) return;

  const ageDays = (Date.now() - fs.statSync(context.ytDlpPath).mtimeMs) / 86_400_000;
  if (ageDays <= BINARY_MAX_AGE_DAYS) return;
  console.log(`${ICON.info} Binary is ${Math.floor(ageDays)} days old.`);
  await updateBinary(context);
}

// -----------------------------------------------------------------------------
// ffmpeg
// -----------------------------------------------------------------------------

function findExecutable(name) {
  const extensions = os.platform() === 'win32' ? process.env.PATHEXT.split(';') : [''];
  for (const dir of process.env.PATH.split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, `${name}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A system install is required: yt-dlp needs ffmpeg to merge and extract
 * streams. ffprobe ships alongside it but is probed separately, because it is
 * what makes cover art embedding possible.
 */
export function resolveFfmpeg() {
  const systemFfmpeg = findExecutable('ffmpeg');
  if (!systemFfmpeg) {
    throw new Error('ffmpeg not found. Install it and make sure it is on your PATH.');
  }
  return { location: path.dirname(systemFfmpeg), hasFfprobe: Boolean(findExecutable('ffprobe')) };
}

// -----------------------------------------------------------------------------
// Scratch space
// -----------------------------------------------------------------------------

/** Holds the extracted metadata so each link is fetched from the network only once. */
export function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-downloader-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
