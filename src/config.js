import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT_DIR = path.dirname(import.meta.dirname);
const ENV_FILE = path.join(ROOT_DIR, '.env');

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/** Always resolves to the newest release, so the rate-limited GitHub API is never hit. */
export const RELEASE_BASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

/** YouTube changes its API often enough that a stale binary silently loses formats. */
export const BINARY_MAX_AGE_DAYS = 7;

export const ARCHIVE_FILENAME = '.yt-dlp-archive.txt';

/** Sentinels that make yt-dlp's own output unambiguous to parse. */
export const SELECTION_TAG = '@SEL@';
export const PROGRESS_TAG = '@DL@';
export const POSTPROCESS_TAG = '@PP@';

export const RELEASE_ASSETS = {
  win32: { x64: 'yt-dlp.exe', arm64: 'yt-dlp_arm64.exe', ia32: 'yt-dlp_x86.exe' },
  darwin: { x64: 'yt-dlp_macos', arm64: 'yt-dlp_macos' },
  linux: { x64: 'yt-dlp_linux', arm64: 'yt-dlp_linux_aarch64' },
};

/** Expands a leading "~" and anchors relative paths so the CWD never matters. */
export function resolvePath(value, base) {
  const expanded = value.startsWith('~') ? path.join(os.homedir(), value.slice(1)) : value;
  return path.resolve(base, expanded);
}

export const CONFIG = {
  linksFile: resolvePath(process.env.LINKS_FILE ?? 'links.txt', ROOT_DIR),
  downloadsDir: resolvePath(process.env.DOWNLOADS_DIR ?? path.join(os.homedir(), 'Downloads'), ROOT_DIR),
  binDir: path.join(ROOT_DIR, 'bin'),
  ytDlpOverride: process.env.YTDLP_PATH ? resolvePath(process.env.YTDLP_PATH, ROOT_DIR) : null,
};
