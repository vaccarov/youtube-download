import fs from 'node:fs';
import path from 'node:path';
import { ALL_CLIENTS, baseArgs, cookieArgs, formatArgs, parsePrinted, printTemplate } from './args.js';
import { SELECTION_TAG } from './config.js';
import { ICON } from './terminal.js';
import { captureOrThrow, warningsOf } from './ytdlp.js';

/** Warnings meaning YouTube withheld formats from the clients we queried. */
const WITHHELD_FORMAT_WARNINGS = [
  /PO Token/i, /SABR/i, /missing a URL/i, /DRM protected/i,
  /challenge solving failed/i, /No supported JavaScript runtime/i,
];

async function extract(context, link, allClients) {
  const args = [...baseArgs(context), ...cookieArgs(context), '-J', '--flat-playlist', link];
  if (allClients) args.push(...ALL_CLIENTS);
  const { stdout, stderr } = await captureOrThrow(context, args);
  return { info: JSON.parse(stdout), warnings: warningsOf(stderr) };
}

/** The best a set of clients offered, used to decide whether asking more is worth it. */
function bestAvailable(info, mediaType) {
  const key = mediaType === 'audio' ? 'abr' : 'height';
  // Audio-only formats have no height, and video-only ones no abr.
  return info.formats.reduce((best, format) => Math.max(best, format[key] ?? 0), 0);
}

function formatsWereWithheld(warnings) {
  return warnings.some((warning) => WITHHELD_FORMAT_WARNINGS.some((pattern) => pattern.test(warning)));
}

/**
 * Available formats depend on which player client answered, so when the default
 * clients look capped we ask every client and keep whichever did better.
 */
async function extractBestClient(context, link) {
  const first = await extract(context, link, false);
  // A flat playlist carries no formats; quality is calibrated on a real entry.
  if (first.info._type === 'playlist') return { ...first, allClients: false };

  const capped = bestAvailable(first.info, context.mediaType) < (context.mediaType === 'audio' ? 128 : 1080);
  if (context.fast || (!capped && !formatsWereWithheld(first.warnings))) {
    return { ...first, allClients: false };
  }

  console.log(`${ICON.info} Default clients look capped, querying every player client...`);
  const second = await extract(context, link, true);
  return bestAvailable(second.info, context.mediaType) > bestAvailable(first.info, context.mediaType)
    ? { ...second, allClients: true }
    : { ...first, allClients: false };
}

function cacheInfo(context, info) {
  const infoPath = path.join(context.tempDir, `${info.id}.info.json`);
  fs.writeFileSync(infoPath, JSON.stringify(info));
  return infoPath;
}

/**
 * One flat extraction covers both cases: a lone video comes back complete with
 * its formats, while a playlist comes back as a cheap list of entries.
 *
 * `media` always holds a real video: the requested one, or a playlist's first
 * entry, which calibrates quality and player client for the whole playlist.
 */
export async function inspect(context, link) {
  const probe = await extractBestClient(context, link);
  if (probe.info._type !== 'playlist') {
    return {
      kind: 'video',
      media: probe.info,
      playlist: null,
      warnings: probe.warnings,
      allClients: probe.allClients,
      infoPath: cacheInfo(context, probe.info),
    };
  }

  const entries = probe.info.entries;
  if (entries.length === 0) throw new Error('This playlist has no playable entry');

  const sample = await extractBestClient(context, entries[0].url);
  return {
    kind: 'playlist',
    media: sample.info,
    playlist: probe.info,
    warnings: [...probe.warnings, ...sample.warnings],
    allClients: sample.allClients,
    infoPath: cacheInfo(context, sample.info),
  };
}

/** Asks yt-dlp which formats it would pick, rather than reimplementing its sorting. */
export async function resolveSelection(context, infoPath) {
  const args = [
    ...baseArgs(context), '--load-info-json', infoPath,
    ...formatArgs(context), '--print', printTemplate(SELECTION_TAG),
  ];
  const { stdout } = await captureOrThrow(context, args);
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(SELECTION_TAG));
  if (!line) throw new Error('yt-dlp did not report any selectable format');
  return parsePrinted(line, SELECTION_TAG);
}

/** The one or two formats yt-dlp will merge, in the order it listed them. */
export function streamsOf(media, formatId) {
  return formatId.split('+').map((id) => media.formats.find((format) => format.format_id === id));
}

export async function listFormats(context, infoPath) {
  const { stdout } = await captureOrThrow(context, [...baseArgs(context), '--load-info-json', infoPath, '-F']);
  process.stdout.write(stdout);
}
