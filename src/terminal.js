import os from 'node:os';

const UNICODE = os.platform() !== 'win32' || Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM);

export const ICON = UNICODE
  ? { app: '🎬', ok: '✅', warn: '⚠️', fail: '❌', down: '⬇️', box: '📦', tool: '🔧', info: 'ℹ️', done: '🎉', list: '📋' }
  : { app: '>', ok: '[ok]', warn: '[!]', fail: '[x]', down: '>>', box: '[+]', tool: '[~]', info: '[i]', done: '*', list: '[=]' };

export const UNKNOWN = '?';

export function field(label, value) {
  console.log(`   ${label.padEnd(10)} ${value}`);
}

/**
 * Every formatter takes a number or a missing value: yt-dlp reports "NA" for
 * anything it does not know, and totals summed from such values are NaN.
 */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return UNKNOWN;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let [size, unit] = [bytes, 0];
  while (size >= 1024 && unit < units.length - 1) [size, unit] = [size / 1024, unit + 1];
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond) {
  const size = formatSize(bytesPerSecond);
  return size === UNKNOWN ? UNKNOWN : `${size}/s`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return UNKNOWN;
  const total = Math.round(seconds);
  const [hours, minutes, rest] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  const tail = `${String(rest).padStart(2, '0')}`;
  return hours === 0 ? `${minutes}:${tail}` : `${hours}:${String(minutes).padStart(2, '0')}:${tail}`;
}

export function formatBitrate(kbps) {
  if (!Number.isFinite(kbps)) return UNKNOWN;
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${Math.round(kbps)} kb/s`;
}

export function formatSampleRate(hertz) {
  if (!Number.isFinite(hertz)) return UNKNOWN;
  return `${(hertz / 1000).toFixed(1)} kHz`;
}

const CHANNEL_LABELS = { 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' };

export function formatChannels(count) {
  if (!Number.isFinite(count)) return UNKNOWN;
  return CHANNEL_LABELS[count] ?? `${count} ch`;
}

export function formatUploadDate(value) {
  if (value === null) return UNKNOWN;
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

export function formatCount(value) {
  if (!Number.isFinite(value)) return UNKNOWN;
  return value.toLocaleString('en-US');
}

export function truncate(text, width) {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

const CODEC_LABELS = [
  [/^av01/, 'AV1'], [/^vp0?9/, 'VP9'], [/^vp0?8/, 'VP8'],
  [/^(avc1|h264)/, 'H.264'], [/^(hvc1|hev1|h265)/, 'H.265'],
  [/^opus/, 'Opus'], [/^mp4a/, 'AAC'], [/^mp3/, 'MP3'],
  [/^ac-?3/, 'AC-3'], [/^ec-?3/, 'E-AC-3'], [/^flac/, 'FLAC'], [/^vorbis/, 'Vorbis'],
];

/** "none" is how yt-dlp marks the missing track of a video-only or audio-only stream. */
export function codecLabel(codec) {
  if (codec === null || codec === 'none') return UNKNOWN;
  const match = CODEC_LABELS.find(([pattern]) => pattern.test(codec));
  return match ? match[1] : codec.split('.')[0];
}

/** YouTube stream URLs name the player client that produced them in their "c" parameter. */
const CLIENT_LABELS = {
  WEB: 'web', MWEB: 'mweb', WEB_EMBEDDED_PLAYER: 'web_embedded', WEB_REMIX: 'web_music',
  WEB_CREATOR: 'web_creator', TVHTML5: 'tv', TVHTML5_SIMPLY: 'tv_simply',
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: 'tv_embedded', ANDROID: 'android', ANDROID_VR: 'android_vr',
  IOS: 'ios', VISIONOS: 'visionos',
};

export function clientLabel(url) {
  const code = new URL(url).searchParams.get('c');
  return code === null ? null : (CLIENT_LABELS[code] ?? code.toLowerCase());
}
