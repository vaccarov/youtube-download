import path from 'node:path';

export const ALL_CLIENTS = ['--extractor-args', 'youtube:player_client=all'];

/**
 * yt-dlp only enables deno by default, and without a JS runtime YouTube's "n"
 * challenge cannot be solved, which silently hides the best formats.
 */
export function baseArgs(context) {
  return [
    '--ignore-config',
    '--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`,
    '--ffmpeg-location', context.ffmpegLocation,
    '--retries', '10', '--fragment-retries', '10', '--file-access-retries', '3',
    '--windows-filenames',
  ];
}

export function cookieArgs(context) {
  return context.cookies ? ['--cookies-from-browser', context.cookies] : [];
}

/**
 * Sorting keeps yt-dlp's own "quality" preference, which demotes the degraded
 * streams an extractor knows about, and prefers https over HLS because YouTube
 * transcodes its HLS renditions lower and reports no file size for them.
 */
const AUDIO_SORT = 'abr,quality,proto,acodec';
const VIDEO_SORT = 'res,fps,hdr:12,quality,proto,br,vcodec,channels,acodec,lang';
const VIDEO_SORT_COMPAT = 'res,fps,quality,proto,vcodec:h264,acodec:aac,br';

/**
 * Quality mode keeps whatever YouTube serves at its best (AV1/VP9 video, and
 * audio copied without re-encoding); compat mode trades quality for H.264/AAC
 * and MP3 playability.
 */
export function formatArgs(context) {
  if (context.mediaType === 'audio') {
    const base = ['-f', 'ba/b', '-S', AUDIO_SORT, '-x'];
    return context.compat ? [...base, '--audio-format', 'mp3', '--audio-quality', '0'] : base;
  }
  return context.compat
    ? ['-f', 'bv*+ba/b', '-S', VIDEO_SORT_COMPAT, '--merge-output-format', 'mp4']
    : ['-f', 'bv*+ba/b', '-S', VIDEO_SORT, '--merge-output-format', 'mkv'];
}

export function embedArgs(context) {
  const args = ['--embed-metadata', '--embed-chapters'];
  // Embedding cover art makes ffmpeg probe the container, which needs ffprobe.
  if (context.hasFfprobe) args.push('--embed-thumbnail');
  if (context.subs && context.mediaType === 'video') args.push('--embed-subs', '--sub-langs', 'fr,en');
  return args;
}

/** Titles are trimmed inside the template so the id and extension always survive. */
export function outputTemplate(context, isPlaylist) {
  const name = '%(title).120s [%(id)s].%(ext)s';
  return isPlaylist
    ? path.join(context.outputDir, '%(playlist_title).100s', `%(playlist_index)02d - ${name}`)
    : path.join(context.outputDir, name);
}

/**
 * Comma-separated names are yt-dlp alternatives: it fills the first one it
 * knows, so no fallback is needed on this side.
 */
const PRINT_FIELDS = [
  'id', 'title', 'channel,uploader', 'upload_date', 'duration', 'view_count',
  'format_id', 'ext', 'resolution', 'fps', 'vcodec', 'acodec', 'dynamic_range',
  'vbr', 'abr', 'audio_channels', 'asr', 'filesize,filesize_approx',
];

const NUMERIC_PRINT_FIELDS = new Set([
  'duration', 'view_count', 'fps', 'vbr', 'abr', 'audio_channels', 'asr', 'filesize',
]);

export function printTemplate(tag) {
  return `${tag}${PRINT_FIELDS.map((name) => `%(${name})s`).join('\t')}`;
}

/** yt-dlp writes "NA" for anything it does not know. */
export function toNumber(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The only place where yt-dlp's text output becomes JS values, so the resulting
 * record has the same shape as a format object from the JSON dump.
 */
export function parsePrinted(line, tag) {
  const values = line.slice(tag.length).split('\t');
  return Object.fromEntries(
    PRINT_FIELDS.map((name, index) => {
      const key = name.split(',')[0];
      const raw = values[index];
      if (NUMERIC_PRINT_FIELDS.has(key)) return [key, toNumber(raw)];
      return [key, raw === 'NA' ? null : raw];
    }),
  );
}
