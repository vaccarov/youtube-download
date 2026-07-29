#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline/promises';
import { CONFIG, resolvePath } from './src/config.js';
import { download } from './src/download.js';
import { inspect, listFormats, resolveSelection, streamsOf } from './src/probe.js';
import { printPlaylistSummary, printVideoSummary, printWarnings } from './src/report.js';
import { createTempDir, ensureBinary, resolveFfmpeg, resolveYtDlpPath } from './src/setup.js';
import { ICON } from './src/terminal.js';
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
  -o, --output DIR     Destination directory (default: ${CONFIG.downloadsDir})
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

const BOOLEAN_FLAGS = {
  '--video': { mediaType: 'video' },
  '--audio': { mediaType: 'audio' },
  '--mp3': { mediaType: 'audio', compat: true },
  '--compat': { compat: true },
  '--subs': { subs: true },
  '-y': { yes: true }, '--yes': { yes: true },
  '--fast': { fast: true },
  '--formats': { listFormats: true },
  '--update': { update: true },
  '--no-update': { noUpdate: true },
  '-v': { verbose: true }, '--verbose': { verbose: true },
  '-h': { help: true }, '--help': { help: true },
};

const VALUE_FLAGS = { '--cookies': 'cookies', '-o': 'outputDir', '--output': 'outputDir' };

function parseArgs(argv) {
  const options = {
    mediaType: null, compat: false, subs: false, cookies: null, outputDir: null, links: [],
    yes: false, fast: false, listFormats: false, update: false, noUpdate: false,
    verbose: false, help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg in BOOLEAN_FLAGS) {
      Object.assign(options, BOOLEAN_FLAGS[arg]);
    } else if (arg in VALUE_FLAGS) {
      index += 1;
      const value = argv[index];
      if (!value || value.startsWith('-')) throw new Error(`Missing value for ${arg}`);
      options[VALUE_FLAGS[arg]] = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.links.push(arg);
    }
  }

  return options;
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
  const chosenDir =
    options.outputDir ?? (await ask(`Destination (default ${CONFIG.downloadsDir}): `, CONFIG.downloadsDir));
  return { mediaType, outputDir: resolvePath(chosenDir, process.cwd()) };
}

// =============================================================================
// Orchestration
// =============================================================================

async function handleLink(context, link) {
  console.log(`\n${ICON.info} Inspecting ${link}`);
  const inspection = await inspect(context, link);
  printWarnings(inspection.warnings);

  if (context.listFormats) {
    await listFormats(context, inspection.infoPath);
    return true;
  }

  const selection = await resolveSelection(context, inspection.infoPath);
  const streams = streamsOf(inspection.media, selection.format_id);
  const isPlaylist = inspection.kind === 'playlist';
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

  return download(context, {
    link,
    isPlaylist,
    infoPath: inspection.infoPath,
    allClients: inspection.allClients,
  });
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
    ? { mediaType: options.mediaType ?? 'video', outputDir: CONFIG.downloadsDir }
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
