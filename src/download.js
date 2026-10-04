import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_CLIENTS, baseArgs, cookieArgs, embedArgs, formatArgs, outputTemplate,
  parsePrinted, printTemplate, toNumber,
} from './args.js';
import { isSignInError } from './cookies.js';
import { ARCHIVE_FILENAME, POSTPROCESS_TAG, PROGRESS_TAG, SELECTION_TAG } from './config.js';
import { createProgressPrinter, describeSelection, printWarnings } from './report.js';
import { ICON, truncate } from './terminal.js';
import { firstError, streamYtDlp, warningsOf } from './ytdlp.js';

/** Bookkeeping steps that always run and say nothing useful about the download. */
const SILENT_POSTPROCESSORS = new Set(['MoveFiles', 'Concat']);

/** Every per-video failure yt-dlp reported, deduplicated: { id, message }. */
function errorsOf(stderr) {
  const seen = new Set();
  const errors = [];
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('ERROR:')) continue;
    const rest = trimmed.replace(/^ERROR:\s*/, '');
    const match = rest.match(/^\[([^\]]+)\]\s*([\w-]{11}):\s?(.*)$/);
    const id = match ? match[2] : null;
    const message = match ? match[3] : rest;
    const key = id ? `${id}:${message}` : message;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({ id, message });
  }
  return errors;
}

/**
 * A playlist is downloaded from its own URL so yt-dlp walks the entries itself,
 * while a lone video reuses the metadata already extracted, saving a round trip.
 */
function sourceArgs({ link, isPlaylist, infoPath, allClients }) {
  return isPlaylist ? [link, ...(allClients ? ALL_CLIENTS : [])] : ['--load-info-json', infoPath];
}

function downloadArgs(context, target) {
  const args = [
    ...baseArgs(context), ...cookieArgs(context), ...sourceArgs(target),
    ...formatArgs(context), ...embedArgs(context),
    '-o', outputTemplate(context, target.isPlaylist),
    // Every download appends here, so any link already listed is skipped.
    '--download-archive', path.join(context.outputDir, ARCHIVE_FILENAME),
    '-N', '4',
    '--quiet', '--progress', '--newline',
    '--progress-delta', process.stdout.isTTY ? '0.5' : '5',
    '--progress-template',
    `download:${PROGRESS_TAG}%(info.format_id)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes,progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s`,
    '--progress-template', `postprocess:${POSTPROCESS_TAG}%(progress.postprocessor)s\t%(progress.status)s`,
    '--no-simulate',
  ];
  if (target.isPlaylist) {
    args.push('--print', printTemplate(`before_dl:${SELECTION_TAG}`));
  }
  return args;
}

export async function download(context, target) {
  fs.mkdirSync(context.outputDir, { recursive: true });
  const printer = createProgressPrinter();

  const { code, stderr } = await streamYtDlp(context, downloadArgs(context, target), (line) => {
    if (line.startsWith(PROGRESS_TAG)) {
      const [format, downloaded, total, speed, eta] = line.slice(PROGRESS_TAG.length).split('\t');
      printer.update({
        format,
        downloaded: toNumber(downloaded),
        total: toNumber(total),
        speed: toNumber(speed),
        eta: toNumber(eta),
      });
    } else if (line.startsWith(POSTPROCESS_TAG)) {
      const [name, status] = line.slice(POSTPROCESS_TAG.length).split('\t');
      if (status === 'started' && !SILENT_POSTPROCESSORS.has(name)) printer.note(`${ICON.tool} ${name}...`);
    } else if (line.startsWith(SELECTION_TAG)) {
      const entry = parsePrinted(line, SELECTION_TAG);
      printer.note(`${ICON.app} ${truncate(entry.title, 60)}  (${describeSelection(entry)})`);
    } else if (context.verbose && line.trim()) {
      printer.note(line);
    }
  });

  const failed = errorsOf(stderr);
  if (code === 0 && failed.length === 0) {
    printer.note(`${ICON.ok} Done.`);
  } else if (!target.isPlaylist) {
    const reason = firstError(stderr) ?? `exit code ${code}`;
    printer.note(`${ICON.fail} ${reason}`);
    // A cached info json holds signed stream URLs, which YouTube expires.
    if (reason.includes('403')) printer.note(`${ICON.info} Stream URLs expired, run again to refresh.`);
  } else {
    printer.note(`${ICON.fail} ${failed.length} video(s) could not be downloaded.`);
  }
  printWarnings(warningsOf(stderr));

  return {
    ok: code === 0 && failed.length === 0,
    failed,
    signInBlocked: failed.some((error) => error.id && isSignInError(error.message)),
  };
}
