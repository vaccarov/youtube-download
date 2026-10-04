#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { parseArgs as parseNodeArgs } from 'node:util';
import { CONFIG, resolvePath } from './src/config.js';
import { findWorkingCookiesBrowser, isSignInError } from './src/cookies.js';
import { download } from './src/download.js';
import { inspect, listFormats, resolveSelection, streamsOf } from './src/probe.js';
import { printPlaylistSummary, printVideoSummary, printWarnings } from './src/report.js';
import { createTempDir, ensureBinary, resolveFfmpeg, resolveYtDlpPath } from './src/setup.js';
import { ICON, truncate } from './src/terminal.js';
import { wasInterrupted } from './src/ytdlp.js';

// =============================================================================
// Command line
// =============================================================================

const USAGE = `${ICON.app} YouTube Downloader

Usage: node index.js [options] [URL...]

Media
  --video              Download video, best quality available (default)
  --audio              Extract audio, keeping the original codec (no re-encode)
  --mp3                Extract audio and convert it to MP3 V0 (compatibility)
  --compat             Prefer H.264/AAC in MP4 instead of the best codecs in MKV
  --subs               Embed French and English subtitles when available

Behaviour
  -o, --output DIR     Destination directory (default: ~/Movies for video, ~/Music for audio)
  -y, --yes            Skip the confirmation prompt
  --fast               Skip the extra probe that hunts for a better player client
  --formats            List every available format and exit
  --cookies BROWSER    Use cookies from a browser (chrome, firefox, edge, ...)

Maintenance
  --update             Update the yt-dlp binary and exit
  --no-update          Do not check the binary age on startup
  -v, --verbose        Echo raw yt-dlp output and commands
  -h, --help           Show this help

URLs may also be listed one per line in ${CONFIG.linksFile} (# starts a comment).`;

/** Declared once, in the shape node:util expects; URLs are the positionals. */
const PARSE_OPTIONS = {
  video: { type: 'boolean' }, audio: { type: 'boolean' }, mp3: { type: 'boolean' },
  compat: { type: 'boolean' }, subs: { type: 'boolean' }, fast: { type: 'boolean' },
  formats: { type: 'boolean' }, update: { type: 'boolean' }, 'no-update': { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' }, verbose: { type: 'boolean', short: 'v' },
  help: { type: 'boolean', short: 'h' }, cookies: { type: 'string' },
  output: { type: 'string', short: 'o' },
};

function parseArgs(argv) {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    options: PARSE_OPTIONS,
    allowPositionals: true,
  });

  return {
    // --mp3 is --audio plus a compatibility conversion.
    mediaType: values.video ? 'video' : values.audio || values.mp3 ? 'audio' : null,
    compat: Boolean(values.compat || values.mp3),
    subs: Boolean(values.subs),
    cookies: values.cookies ?? null,
    outputDir: values.output ?? null,
    links: positionals,
    yes: Boolean(values.yes),
    fast: Boolean(values.fast),
    listFormats: Boolean(values.formats),
    update: Boolean(values.update),
    noUpdate: Boolean(values['no-update']),
    verbose: Boolean(values.verbose),
    help: Boolean(values.help),
  };
}

function collectLinks(fromArgs) {
  if (fromArgs.length > 0) return fromArgs;
  if (!fs.existsSync(CONFIG.linksFile)) return [];
  return fs
    .readFileSync(CONFIG.linksFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Falls back to the default answer when there is no terminal to ask (scripts, cron, CI). */
async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim() || fallback;
  } finally {
    rl.close();
  }
}

async function askMissingOptions(options) {
  const mediaType =
    options.mediaType ??
    ((await ask('Media type - [1] video, [0] audio (default 1): ', '1')) === '0' ? 'audio' : 'video');
  const defaultDir = mediaType === 'audio' ? CONFIG.audioDir : CONFIG.videoDir;
  const chosenDir =
    options.outputDir ?? (options.mediaType ? defaultDir : await ask(`Destination (default ${defaultDir}): `, defaultDir));
  return { mediaType, outputDir: resolvePath(chosenDir, process.cwd()) };
}

/** A failing run lists every blocked video once, with a title when one is known. */
function printFailedVideos(failed, titleById = new Map()) {
  if (failed.length === 0) return;
  console.log(`${ICON.fail} ${failed.length} video(s) could not be downloaded:`);
  for (const { id, message } of failed) {
    const title = id ? titleById.get(id) : null;
    const label = title ? `${truncate(title, 55)} (${id})` : (id ?? '—');
    console.log(`   ${label}: ${truncate(message, 120)}`);
  }
}

// =============================================================================
// Orchestration
// =============================================================================

async function handleLink(context, link) {
  console.log(`\n${ICON.info} Inspecting ${link}`);

  let inspection;
  try {
    inspection = await inspect(context, link);
  } catch (error) {
    if (context.cookies || !isSignInError(error.message) || wasInterrupted()) throw error;
    console.log(`${ICON.info} This content needs a signed-in session, looking for browser cookies...`);
    const browser = await findWorkingCookiesBrowser(context, link);
    if (!browser) throw error;
    console.log(`${ICON.info} Retrying inspection with ${browser} cookies...`);
    context = { ...context, cookies: browser };
    inspection = await inspect(context, link);
  }
  printWarnings(inspection.warnings);

  if (context.listFormats) {
    await listFormats(context, inspection.infoPath);
    return true;
  }

  const isPlaylist = inspection.kind !== 'video';

  // Anything already in yt-dlp's archive is skipped by the download itself.
  const selection = await resolveSelection(context, inspection.infoPath);
  const streams = streamsOf(inspection.media, selection.format_id);
  const summary = { ...inspection, selection, streams };

  if (isPlaylist) {
    printPlaylistSummary(context, summary);
  } else {
    printVideoSummary(context, summary);
  }

  if (!context.yes && !/^y(es)?$/i.test(await ask('\n   Download? [Y/n] ', 'y'))) {
    console.log(`   ${ICON.info} Skipped.`);
    return true;
  }

  const target = {
    link,
    isPlaylist,
    infoPath: inspection.infoPath,
    allClients: inspection.allClients,
  };

  const titleById = new Map((isPlaylist ? inspection.playlist.entries : []).map((entry) => [entry.id, entry.title]));
  if (!isPlaylist) titleById.set(summary.media.id, summary.selection.title);

  let result = await download(context, target);
  let retriedWithCookies = false;

  if (!result.ok && !context.cookies && result.signInBlocked && !wasInterrupted()) {
    const firstId = result.failed.find((error) => error.id)?.id;
    const probeUrl = firstId ? `https://www.youtube.com/watch?v=${firstId}` : link;
    console.log(`${ICON.info} Some videos need a signed-in YouTube session, looking for browser cookies...`);
    const browser = await findWorkingCookiesBrowser(context, probeUrl);
    if (browser) {
      console.log(`${ICON.info} Retrying blocked videos with ${browser} cookies...`);
      context = { ...context, cookies: browser };
      result = await download(context, target);
      retriedWithCookies = true;
    }
  }

  if (result.ok && retriedWithCookies) {
    console.log(`${ICON.ok} Blocked videos downloaded with ${context.cookies} cookies.`);
  } else if (!result.ok) {
    printFailedVideos(result.failed, titleById);
    if (result.failed.some((error) => error.id && isSignInError(error.message)) && !context.cookies) {
      console.log(`${ICON.info} Pass --cookies BROWSER (e.g. --cookies firefox) to download the blocked videos.`);
    }
  }
  return result.ok;
}

/**
 * Everything the run needs is validated here, once, and only when it is needed:
 * --help touches nothing, --update needs the binary alone.
 */
async function createContext(options) {
  const binary = { ytDlpPath: resolveYtDlpPath(), verbose: options.verbose };
  await ensureBinary(binary, { skipUpdate: options.noUpdate });

  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg.hasFfprobe) {
    console.log(`${ICON.warn} ffprobe not found, so cover art is not embedded. Install ffmpeg system-wide to enable it.`);
  }

  const choices = options.listFormats
    ? { mediaType: options.mediaType ?? 'video', outputDir: CONFIG.videoDir }
    : await askMissingOptions(options);

  return Object.freeze({
    ...options,
    ...choices,
    ytDlpPath: binary.ytDlpPath,
    ffmpegLocation: ffmpeg.location,
    hasFfprobe: ffmpeg.hasFfprobe,
    tempDir: createTempDir(),
  });
}

async function main(options) {
  if (options.help) {
    console.log(USAGE);
    return;
  }

  console.log(`${ICON.app} YouTube Downloader`);

  if (options.update) {
    await ensureBinary({ ytDlpPath: resolveYtDlpPath(), verbose: options.verbose }, { forceUpdate: true });
    return;
  }

  const links = collectLinks(options.links);
  if (links.length === 0) {
    console.log(`${ICON.warn} No URL given and none found in ${CONFIG.linksFile}.\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const context = await createContext(options);

  let failures = 0;
  for (const link of links) {
    if (wasInterrupted()) break;
    try {
      if (!(await handleLink(context, link))) failures += 1;
    } catch (error) {
      console.error(`${ICON.fail} ${link}: ${error.message}`);
      if (context.verbose) console.error(error.stack);
      failures += 1;
    }
  }

  if (wasInterrupted()) {
    console.log(`\n${ICON.warn} Interrupted, partial files were kept for resuming.`);
    process.exitCode = 130;
  } else if (failures > 0) {
    console.log(`\n${ICON.fail} ${failures} of ${links.length} link(s) failed.`);
    process.exitCode = 1;
  } else if (!context.listFormats) {
    console.log(`\n${ICON.done} All downloads complete.`);
  }
}

const argv = process.argv.slice(2);
// Read before parsing so an invalid command line can still report its stack.
const verbose = argv.includes('-v') || argv.includes('--verbose');

try {
  await main(parseArgs(argv));
} catch (error) {
  console.error(`${ICON.fail} ${error.message}`);
  if (verbose) console.error(error.stack);
  process.exitCode = 1;
}
