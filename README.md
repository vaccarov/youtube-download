# YouTube Downloader

A standalone Node.js script to download videos and audio from YouTube using `yt-dlp`.

## Features

- ✅ **Automatic Installation** - `yt-dlp` is automatically downloaded on the first run.
- ✅ **Playlist Support** - Automatically detects and downloads entire playlists.
- ✅ **Audio Download** - MP3 format with customizable quality (128, 192, 256, 320 kbps).
- ✅ **Video Download** - MP4 format with quality selection (720p, 1080p, or best available).
- ✅ **Real-time Progress** - Displays download percentage, speed, and ETA.
- ✅ **Built-in ffmpeg** - Uses `ffmpeg-static`, no manual installation required.
- ✅ **Interactive & CLI Modes** - Use it interactively or via command-line arguments.

## Prerequisites

- **Node.js** >= 24.0.0

The `yt-dlp` binary is managed automatically by the script.

## Installation

```bash
git clone <repository-url>
cd youtube-download
npm install
```

## Configuration

The script uses a `.env` file for configuration. Ensure it exists in the root directory:

```env
LINKS_FILE=links.txt
DOWNLOADS_DIR=downloads
YTDLP_PATH=./bin/yt-dlp
```

> **Note:** The `YTDLP_PATH` is where the binary will be downloaded if not present.

## Usage

### 1. Interactive Mode

Simply run the script. If no URL is provided as an argument, it will check your `links.txt` file or prompt for input.

```bash
npm start
```

### 2. Quick Commands

You can use predefined npm scripts to skip some prompts:

```bash
# Download as audio (320kbps)
npm run audio -- "https://www.youtube.com/watch?v=VIDEO_ID"

# Download as video (Best quality)
npm run video -- "https://www.youtube.com/watch?v=VIDEO_ID"
```

### 3. Using a Links File

Create a `links.txt` file (configured in `.env`) with one URL per line:

```text
https://www.youtube.com/watch?v=VIDEO_ID_1
https://www.youtube.com/watch?v=VIDEO_ID_2
# Lines starting with # are ignored
https://www.youtube.com/playlist?list=PLAYLIST_ID
```

Then run:

```bash
npm start
```

## Options

When running interactively, the script will ask for:

1. **Media Type**: Audio (0) or Video (1).
2. **Quality**: 
   - Audio: 128, 192, 256, or 320 kbps.
   - Video: 720, 1080, or "best".
3. **Destination**: Defaults to `./downloads` or a subfolder for playlists.

## File Structure

```
youtube-download/
├── index.js        # Main script
├── package.json    # Project configuration
├── .env            # Environment variables
├── links.txt       # (Optional) List of YouTube URLs
├── bin/            # Location of yt-dlp binary
└── downloads/      # Default download directory
```

## Dependencies

| Package | Description |
|---------|-------------|
| `yt-dlp-wrap` | Node.js wrapper for yt-dlp |
| `ffmpeg-static` | Static ffmpeg binaries |
| `fluent-ffmpeg` | ffmpeg command wrapper |
| `dotenv` | Environment variable loader |

## License

MIT
