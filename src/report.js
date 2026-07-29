import path from 'node:path';
import {
  clientLabel, codecLabel, field, formatBitrate, formatChannels, formatCount, formatDuration,
  formatSampleRate, formatSize, formatSpeed, formatUploadDate, ICON, truncate, UNKNOWN,
} from './terminal.js';

// -----------------------------------------------------------------------------
// Stream descriptions
// -----------------------------------------------------------------------------

/** Unknown values are dropped rather than shown as "?", which reads as noise here. */
function describeStream(parts) {
  return parts.filter((part) => part && part !== UNKNOWN).join(' · ');
}

export function describeVideoStream(stream) {
  return describeStream([
    stream.format_id, stream.resolution, stream.fps ? `@${stream.fps}` : null,
    codecLabel(stream.vcodec), stream.dynamic_range,
    formatBitrate(stream.vbr ?? stream.tbr), formatSize(stream.filesize ?? stream.filesize_approx),
  ]);
}

export function describeAudioStream(stream) {
  // On a combined stream, tbr covers video too, so only a real abr is meaningful.
  const bitrate = stream.abr ?? (stream.vcodec === 'none' ? stream.tbr : null);
  return describeStream([
    stream.format_id, codecLabel(stream.acodec), formatBitrate(bitrate),
    formatChannels(stream.audio_channels), formatSampleRate(stream.asr),
    formatSize(stream.filesize ?? stream.filesize_approx),
  ]);
}

/** A parsed --print record carries the same keys as a format object, so both share this. */
export function describeSelection(selection) {
  return selection.vcodec === 'none' ? describeAudioStream(selection) : describeVideoStream(selection);
}

function describeClient(streams, allClients) {
  return [clientLabel(streams[0].url) ?? 'n/a', allClients ? '(all clients queried)' : null]
    .filter(Boolean)
    .join(' ');
}

// -----------------------------------------------------------------------------
// Summaries shown before downloading
// -----------------------------------------------------------------------------

export function printVideoSummary(context, { selection, streams, allClients }) {
  const video = streams.find((stream) => stream.vcodec !== 'none');
  const audio = streams.find((stream) => stream.acodec !== 'none');

  console.log(`\n${ICON.app} ${selection.title}`);
  field('Channel', selection.channel);
  field('Details', `${formatDuration(selection.duration)} · uploaded ${formatUploadDate(selection.upload_date)} · ${formatCount(selection.view_count)} views`);
  console.log('');
  if (context.mediaType === 'video') field('Video', describeVideoStream(video));
  // A silent video has no audio track to describe.
  if (audio) field('Audio', describeAudioStream(audio));
  field('Client', describeClient(streams, allClients));

  const container =
    context.mediaType === 'video' ? selection.ext : context.compat ? 'mp3' : `${selection.ext} (copied)`;
  field('Output', `${container} · ${formatSize(selection.filesize)}`);
  field('Folder', context.outputDir);
}

export function printPlaylistSummary(context, { playlist, selection, streams, allClients }) {
  const entries = playlist.entries;
  const totalDuration = entries.reduce((sum, entry) => sum + entry.duration, 0);
  const estimate = selection.filesize && selection.duration
    ? (selection.filesize / selection.duration) * totalDuration
    : null;
  const video = streams.find((stream) => stream.vcodec !== 'none');

  console.log(`\n${ICON.list} Playlist: ${playlist.title}`);
  field('Videos', `${entries.length} · total ${formatDuration(totalDuration)}`);
  field('Quality', `sample #1 → ${video ? describeVideoStream(video) : describeAudioStream(streams[0])}`);
  field('Client', describeClient(streams, allClients));
  field('Estimate', estimate ? `≈ ${formatSize(estimate)} total` : UNKNOWN);
  field('Folder', path.join(context.outputDir, playlist.title));
  console.log('');

  // A flat entry carries no playlist_index: its position in the list is the index.
  const preview = entries.slice(0, 10);
  for (const [offset, entry] of preview.entries()) {
    const index = String(offset + 1).padStart(2, '0');
    console.log(`   ${index}  ${truncate(entry.title, 58).padEnd(58)} ${formatDuration(entry.duration)}`);
  }
  if (entries.length > preview.length) console.log(`   ... and ${entries.length - preview.length} more`);
}

/** Everything yt-dlp warned about, once each: repeated clients repeat their warnings. */
export function printWarnings(warnings) {
  for (const warning of new Set(warnings)) {
    console.log(`${ICON.warn} ${truncate(warning.replace(/^WARNING:\s*/, ''), 150)}`);
  }
}

// -----------------------------------------------------------------------------
// Live progress
// -----------------------------------------------------------------------------

const BAR_WIDTH = 20;

export function createProgressPrinter() {
  const interactive = Boolean(process.stdout.isTTY);
  let dirty = false;

  const eraseLine = () => {
    process.stdout.cursorTo(0);
    process.stdout.clearLine(0);
    dirty = false;
  };

  return {
    update({ format, downloaded, total, speed, eta }) {
      const ratio = total ? Math.min(downloaded / total, 1) : 0;
      const percent = `${(ratio * 100).toFixed(1)}%`.padStart(6);
      const stream = format ? `${format} ` : '';
      const details = `${formatSize(downloaded)} / ${formatSize(total)} · ${formatSpeed(speed)} · ETA ${formatDuration(eta)}`;

      if (!interactive) {
        console.log(`   ${stream}${percent} ${details}`);
        return;
      }
      const filled = Math.round(ratio * BAR_WIDTH);
      eraseLine();
      process.stdout.write(`   ${ICON.down} ${stream}${percent} [${'#'.repeat(filled)}${'.'.repeat(BAR_WIDTH - filled)}] ${details}`);
      dirty = true;
    },
    note(text) {
      if (dirty) eraseLine();
      console.log(`   ${text}`);
    },
  };
}
