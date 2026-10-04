# YouTube Downloader

Download **music** and **videos** from YouTube — a single link, a whole
**playlist**, or every video of a **channel** — at the best quality YouTube
actually offers. A dependency-free Node.js CLI that drives `yt-dlp`.

## Install

```bash
npm install
```

- **Node.js** >= 22
- **ffmpeg** on your `PATH` (its `ffprobe` companion enables cover art)
- Works on macOS, Linux and Windows. The matching `yt-dlp` binary is downloaded
  on first run and SHA-256 verified.

## Usage

```bash
npm run audio "URL"   # music -> ~/Music, original codec kept, never re-encoded
npm run video "URL"   # video -> ~/Movies, best quality, merged into MKV
npm start "URL"       # asks which of the two, and where
```

The same commands take a playlist or a whole channel, each into its own folder:

```bash
npm run video "https://www.youtube.com/playlist?list=PLAYLIST_ID"
npm run audio "https://www.youtube.com/@handle/videos"
```

Every link is inspected first: you get the streams chosen, the player client that
served them and the estimated size, then a confirmation prompt (`-y` skips it).
URLs can also sit one per line in `links.txt`, `#` for comments; with no URL
argument the script reads that file.

### Options

| Option | Effect |
| --- | --- |
| `--video` | Best video quality (default) |
| `--audio` | Audio only, original codec kept |
| `--mp3` | Audio only, converted to MP3 V0 |
| `--compat` | H.264/AAC in MP4 instead of the best codecs in MKV |
| `--subs` | Embed French and English subtitles when available |
| `-o, --output DIR` | Destination (default `~/Movies` video, `~/Music` audio) |
| `-y, --yes` | Skip the confirmation prompt |
| `--fast` | Skip the extra probe that hunts for a better player client |
| `--formats` | List every available format and exit |
| `--cookies BROWSER` | Use cookies from `chrome`, `firefox`, `edge`, ... |
| `--update` / `--no-update` | Update the binary now / do not age-check it |
| `-v, --verbose` | Echo the raw `yt-dlp` commands and output |
| `-h, --help` | Show this help |

## Configuration

An optional `.env` in the project root. Relative paths resolve against the
project directory, not your shell, and `~` expands to your home.

| Variable | Default |
| --- | --- |
| `LINKS_FILE` | `links.txt` |
| `VIDEO_DIR` | `~/Movies` |
| `AUDIO_DIR` | `~/Music` |
| `YTDLP_PATH` | `./bin/<platform-specific name>` |

## Good to know

- Files are named `<title> [<id>].<ext>`; playlist and channel entries get an
  `<NN> - ` prefix inside their own folder.
- An archive (`.yt-dlp-archive.txt`) next to the output folder records what has
  been downloaded, so a re-run fetches only what is new — for a lone URL too.
  Deleting a file does not bring it back; remove its line from the archive.
- Ctrl+C is safe: `.part` files stay behind and the next run resumes.
- Exit codes: `0` success, `1` at least one link failed, `130` interrupted.
- The `yt-dlp` binary self-updates when older than 7 days.

## Tests

`npm test` downloads real 6-second clips from yt-dlp's own test account — one
video in both media modes, a one-video playlist and a three-video channel — then
checks the files, the archive skip and the output folders. Needs network access.

## License

MIT
