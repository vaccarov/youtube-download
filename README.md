# YouTube Downloader

A dependency-light Node.js CLI that drives `yt-dlp` to download videos and audio
at the highest quality YouTube actually offers.

## Why this exists

Calling `yt-dlp` directly works, but getting the *best* stream needs a few
non-obvious flags. This script handles them for you:

- **A JavaScript runtime is mandatory.** Without one, YouTube's "n" challenge
  cannot be solved and part of the format list silently disappears. `yt-dlp`
  only enables `deno` by default, so the script points it at the Node binary it
  is already running on (`--js-runtimes node:<path to node>`).
- **Available formats depend on the player client.** The script probes with the
  default clients, and when the result looks capped (or warnings show YouTube
  withheld streams) it re-probes with every client and keeps the better answer.
- **Audio is copied, not re-encoded.** Converting a 128 kb/s Opus source to
  "320 kb/s MP3" produces a bigger file that sounds worse than the original.

## Requirements

- **Node.js** >= 22 (uses `import.meta.dirname` and `process.loadEnvFile`)
- Everything else is handled for you: the `yt-dlp` binary is downloaded on first
  run (with SHA-256 verification) and `ffmpeg` comes from `ffmpeg-static`.

Installing `ffmpeg` system-wide is still recommended: `ffmpeg-static` ships
`ffmpeg` without `ffprobe`, and `ffprobe` is required to embed cover art. The
script detects a system install first and falls back to the bundled binary.

## Installation

```bash
npm install
```

## Usage

```bash
# Interactive: asks for media type and destination
npm start -- "https://www.youtube.com/watch?v=VIDEO_ID"

# Best video quality, no questions asked
node index.js --video -y "https://www.youtube.com/watch?v=VIDEO_ID"

# Audio only, original codec preserved
node index.js --audio -y "https://www.youtube.com/watch?v=VIDEO_ID"

# A whole playlist, into its own subfolder
node index.js --video "https://www.youtube.com/playlist?list=PLAYLIST_ID"

# Inspect what is available without downloading
node index.js --formats "https://www.youtube.com/watch?v=VIDEO_ID"
```

URLs can also be listed one per line in `links.txt`; lines starting with `#` are
ignored. Running the script with no URL argument falls back to that file.

### Options

| Option | Effect |
| --- | --- |
| `--video` | Download video at the best quality available (default) |
| `--audio` | Extract audio, keeping the original codec |
| `--mp3` | Extract audio and convert it to MP3 V0 |
| `--compat` | Prefer H.264/AAC in MP4 over the best codecs in MKV |
| `--subs` | Embed French and English subtitles when available |
| `-o, --output DIR` | Destination directory |
| `-y, --yes` | Skip the confirmation prompt |
| `--fast` | Skip the extra probe that hunts for a better player client |
| `--formats` | List every available format and exit |
| `--cookies BROWSER` | Read cookies from `chrome`, `firefox`, `edge`, ... |
| `--update` | Update the `yt-dlp` binary and exit |
| `--no-update` | Do not check the binary age on startup |
| `-v, --verbose` | Echo the raw `yt-dlp` commands and output |

## What you see before downloading

Every link is inspected first, and the summary shows exactly which streams were
selected, which player client served them, and how large the result will be:

```
🎬 COSTA RICA IN 4K 60fps HDR (ULTRA HD)
   Channel    Jacob + Katie Schwarz
   Details    5:14 · uploaded 13/06/2018 · 332,016,889 views

   Video      337 · 3840x2160 · @60 · VP9 · HDR10 · 28.9 Mb/s · 1.1 GiB
   Audio      251 · Opus · 133 kb/s · stereo · 48.0 kHz · 5.0 MiB
   Client     android_vr
   Output     mkv · 1.1 GiB
   Folder     /home/you/Downloads
```

For a playlist you get its title, entry count, total duration, a size estimate
extrapolated from the first entry, and a preview of the first ten titles.

## Quality strategy

Video is selected with `-f "bv*+ba/b"` sorted by
`res,fps,hdr:12,quality,proto,br,vcodec,channels,acodec,lang`:

- resolution, frame rate and HDR come first;
- `quality` keeps `yt-dlp`'s own preference, which demotes streams it knows are
  degraded;
- `proto` prefers plain HTTPS over HLS, because YouTube transcodes its HLS
  renditions lower and reports no file size for them;
- `br` then picks the fattest stream, so a high-bitrate VP9 wins over a smaller
  AV1 at the same resolution. Swap `br` and `vcodec` in `VIDEO_SORT`
  (`src/args.js`) if you would rather have the newest codec and smaller files.

Streams are merged into MKV, which can hold AV1/VP9 with Opus without
re-encoding. `--compat` switches to H.264/AAC in MP4 for players that need it.

Audio uses `-f "ba/b"` sorted by `abr,quality,proto,acodec` and is extracted
with `-x` and no target format, so the original Opus or AAC stream is copied
straight out of its container.

## Configuration

A `.env` file is optional; see `.env.example`. Relative paths are resolved
against the project directory, not your shell's working directory, and `~`
expands to your home directory.

| Variable | Default |
| --- | --- |
| `LINKS_FILE` | `links.txt` |
| `DOWNLOADS_DIR` | `~/Downloads` |
| `YTDLP_PATH` | `./bin/<platform-specific name>` |

## Project layout

`index.js` holds the command line and the orchestration; everything it needs is
resolved once at startup, in `createContext`, and passed around as a frozen
`context` object.

| File | Responsibility |
| --- | --- |
| `index.js` | Flags, prompts, link loop, exit codes |
| `src/config.js` | `.env` loading, paths, constants |
| `src/setup.js` | Platform check, `yt-dlp` binary, `ffmpeg`, temp dir |
| `src/ytdlp.js` | Spawning `yt-dlp`, line reading, Ctrl+C |
| `src/args.js` | `yt-dlp` arguments, format sorting, output parsing |
| `src/probe.js` | Extraction, player client escalation, format selection |
| `src/report.js` | Summaries, warnings, progress bar |
| `src/download.js` | The download run itself |
| `src/terminal.js` | Icons and value formatting |

## Platform support

Works on Windows, Linux and macOS. The correct `yt-dlp` build is picked from
`os.platform()` and `os.arch()`, covering x64, ARM64 and 32-bit Windows, plus
musl variants on Alpine. Filenames are sanitised for Windows everywhere, so a
download folder stays portable across machines and external drives.

## Behaviour worth knowing

- **Playlists get a download archive.** `.yt-dlp-archive.txt` is written next to
  the playlist folder, so re-running the same playlist only fetches what is new.
- **Interrupting is safe.** Ctrl+C forwards the signal to `yt-dlp`, which leaves
  `.part` files behind; run the command again to resume.
- **Exit codes are meaningful.** `0` when everything succeeded, `1` when at
  least one link failed, `130` after an interrupt. Failures are counted and
  reported instead of being swallowed.
- **The binary self-updates.** If `yt-dlp` is more than 7 days old it runs
  `yt-dlp -U` before working, because YouTube API changes break old builds.
  Use `--no-update` to skip the check.
- **One network extraction per video.** Metadata is extracted once, cached as
  JSON, and reused for both the summary and the download. Signed stream URLs do
  expire, so if a download fails with HTTP 403 just run it again.

## License

MIT
