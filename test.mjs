#!/usr/bin/env node
/**
 * Integration test: really downloads media from YouTube.
 *
 *   npm test
 *
 * Needs network access and ffmpeg on PATH. Every resource is 6 seconds long and
 * lives on yt-dlp's own test account, so a full run moves a few megabytes.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INDEX = path.join(import.meta.dirname, 'index.js');

const VIDEO = 'https://www.youtube.com/watch?v=gHKT4uU8Zng';
const PLAYLIST = 'https://www.youtube.com/playlist?list=PLt5yu3-wZAlQAaPZ5Z-rJoTdbT-45Q7c0';
const CHANNEL = 'https://www.youtube.com/channel/UCiu-3thuViMebBjw_5nWYrA/videos';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-downloader-test-'));
let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

/** Finished media files, ignoring the archive and any in-progress .part file. */
function mediaFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((name) => !/(^|[\\/])\.|\.part$/.test(name))
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile());
}

function download(name, url, flags, dir = path.join(root, name)) {
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [INDEX, ...flags, '-y', '--fast', '--no-update', '-o', dir, url],
    { encoding: 'utf8', timeout: 300_000 },
  );
  const files = mediaFiles(dir);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${name}: exit ${run.status}, ${files.length} file(s), ${seconds}s`);
  if (run.status !== 0) {
    console.log((run.stdout + run.stderr).trim().split('\n').slice(-4).join('\n'));
  }
  return { dir, status: run.status, files };
}

console.log(`Downloading real 6-second clips into ${root}`);

const video = download('video', VIDEO, ['--video']);
check('exits 0', video.status === 0);
check('one file', video.files.length === 1, video.files.map((f) => path.basename(f)).join());
check('id in the filename', Boolean(video.files[0]?.includes('[gHKT4uU8Zng]')));
check('playable container', /\.(mkv|mp4|webm)$/.test(video.files[0] ?? ''));

const archive = path.join(video.dir, '.yt-dlp-archive.txt');
check('archive written', fs.existsSync(archive));

// A second run must be a no-op: the id is in the archive and the file untouched.
const before = video.files[0] ? fs.statSync(video.files[0]).mtimeMs : null;
const again = download('video-again', VIDEO, ['--video'], video.dir);
check('re-run exits 0', again.status === 0);
check('re-run added nothing', again.files.length === video.files.length);
check('re-run left the file alone', Boolean(video.files[0]) && fs.statSync(video.files[0]).mtimeMs === before);

const audio = download('audio', VIDEO, ['--audio']);
check('exits 0', audio.status === 0);
check('one file', audio.files.length === 1);
check('audio container', /\.(m4a|opus|webm|ogg|mp3|flac|wav|mp4)$/.test(audio.files[0] ?? ''));

const playlist = download('playlist', PLAYLIST, ['--video']);
check('exits 0', playlist.status === 0);
check('one file', playlist.files.length === 1);
check('nested in its own folder', Boolean(playlist.files[0]) && path.dirname(playlist.files[0]) !== playlist.dir);

// ponytail: bounded only by the test account staying small; add a playlist-items
// passthrough to index.js if you ever point this at a real channel.
const channel = download('channel', CHANNEL, ['--video']);
check('exits 0', channel.status === 0);
check('every video', channel.files.length >= 3, `${channel.files.length}`);
check('nested in its own folder', Boolean(channel.files[0]) && path.dirname(channel.files[0]) !== channel.dir);

if (failures === 0) {
  fs.rmSync(root, { recursive: true, force: true });
  console.log('\nAll download tests passed.');
} else {
  console.log(`\n${failures} check(s) failed. Files kept in ${root}`);
  process.exitCode = 1;
}
