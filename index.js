import YTDlpWrap from "yt-dlp-wrap";
import ffmpegPath from "ffmpeg-static";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import os from "os";
import https from "https";

dotenv.config({quiet: true});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === CONFIGURATION ===
const LINKS_FILE = process.env.LINKS_FILE;
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR;
const YTDLP_PATH = process.env.YTDLP_PATH;

/**
 * Downloads a file from a URL to a destination path
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        fs.chmodSync(dest, 0o755);
        resolve();
      });
    }).on("error", (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/**
 * Downloads yt-dlp binary if not present
 */
async function ensureYtDlp() {
  if (fs.existsSync(YTDLP_PATH)) {
    // Check if it's a directory (might happen if something went wrong)
    if (fs.lstatSync(YTDLP_PATH).isDirectory()) {
      console.log("⚠️ Found a directory at YTDLP_PATH. Removing it...");
      fs.rmSync(YTDLP_PATH, { recursive: true, force: true });
    } else {
      console.log("✅ yt-dlp binary found.");
      return;
    }
  }

  console.log("📥 Downloading yt-dlp binary (first run only)...");
  
  // Create bin directory
  const binDir = path.dirname(YTDLP_PATH);
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  try {
    const platform = os.platform();
    const releases = await YTDlpWrap.default.getGithubReleases(1, 1);
    const latestRelease = releases[0];
    
    let assetName = "yt-dlp";
    if (platform === "darwin") {
      assetName = "yt-dlp_macos";
    } else if (platform === "linux") {
      assetName = "yt-dlp_linux";
    } else if (platform === "win32") {
      assetName = "yt-dlp.exe";
    }

    const asset = latestRelease.assets.find(a => a.name === assetName);
    
    if (asset) {
      console.log(`🚀 Downloading ${assetName} for ${platform}...`);
      await downloadFile(asset.browser_download_url, YTDLP_PATH);
      console.log("✅ yt-dlp downloaded successfully!");
    } else {
      console.log("⚠️ Platform-specific asset not found, falling back to default...");
      await YTDlpWrap.default.downloadFromGithub(YTDLP_PATH);
      console.log("✅ yt-dlp downloaded successfully!");
    }
  } catch (error) {
    console.error(`❌ Failed to download yt-dlp: ${error.message}`);
    console.log("\n💡 Manual alternative: Download yt-dlp from https://github.com/yt-dlp/yt-dlp/releases");
    console.log(`   and place it in: ${binDir}`);
    process.exit(1);
  }
}

/**
 * Creates a readline interface for terminal input
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompts the user with a question and returns the answer
 */
function prompt(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Sanitizes a filename by removing invalid characters
 */
function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

/**
 * Gets download choices from the user via terminal input.
 */
async function getUserChoices(playlistTitle = null) {
  const rl = createReadlineInterface();

  try {
    // 1. Choose media type
    let mediaTypeChoice = "";
    while (mediaTypeChoice !== "0" && mediaTypeChoice !== "1") {
      mediaTypeChoice = await prompt(
        rl,
        "Enter 1 for video, 0 for audio [default: 0]: "
      );
      if (!mediaTypeChoice) {
        mediaTypeChoice = "0";
      }
    }
    const mediaType = mediaTypeChoice === "0" ? "audio" : "video";

    // 2. Choose quality
    let quality = "";
    if (mediaType === "audio") {
      const audioQualities = ["128", "192", "256", "320"];
      while (!audioQualities.includes(quality)) {
        quality = await prompt(
          rl,
          `Choose audio quality in kbps (${audioQualities.join(", ")}) [default: 320]: `
        );
        if (!quality) {
          quality = "320";
        }
      }
    } else {
      const videoQualities = ["720", "1080", "best"];
      while (!videoQualities.includes(quality)) {
        quality = await prompt(
          rl,
          `Choose video quality in p (${videoQualities.join(", ")}) [default: best]: `
        );
        if (!quality) {
          quality = "best";
        }
      }
    }

    // 3. Choose destination directory
    const defaultDir = playlistTitle
      ? path.join(DOWNLOADS_DIR, sanitizeFilename(playlistTitle))
      : DOWNLOADS_DIR;

    const outputDirStr = await prompt(
      rl,
      `Enter output directory [default: ${defaultDir}]: `
    );
    const outputDir = outputDirStr || defaultDir;

    return { mediaType, quality, outputDir };
  } finally {
    rl.close();
  }
}

/**
 * Downloads media using yt-dlp
 */
async function downloadMedia(links, outputDir, mediaType, quality) {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ytDlpWrap = new YTDlpWrap.default(YTDLP_PATH);

  for (const link of links) {
    console.log(`\n📥 Processing: ${link}`);

    const baseArgs = [
      link,
      "-o", path.join(outputDir, "%(title)s.%(ext)s"),
      "--no-playlist-reverse",
      "--no-warnings",
      "--ffmpeg-location", ffmpegPath,
    ];

    let formatArgs = [];

    if (mediaType === "audio") {
      formatArgs = [
        "-f", "ba/b",
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", `${quality}K`,
      ];
    } else {
      const videoFormat = quality !== "best" ? `bv*[height<=${quality}]+ba/b` : "bv*+ba/b";
      formatArgs = [
        "-f", videoFormat,
        "--merge-output-format", "mp4",
      ];
    }

    const args = [...baseArgs, ...formatArgs];

    try {
      await new Promise((resolve, reject) => {
        let currentTitle = "";
        
        const ytDlpProcess = ytDlpWrap.exec(args);

        ytDlpProcess.on("progress", (progress) => {
          const percent = progress.percent ? `${progress.percent.toFixed(1)}%` : "...";
          const speed = progress.currentSpeed || "...";
          const eta = progress.eta || "?";
          process.stdout.write(
            `\r⬇️  ${percent} @ ${speed} (ETA: ${eta}s)          `
          );
        });

        ytDlpProcess.on("ytDlpEvent", (eventType, eventData) => {
          if (eventType === "download") {
            // Extract title from destination
            const destMatch = eventData.match(/Destination: .*[/\\](.+)\.(mp3|mp4|webm|m4a)/);
            if (destMatch) {
              currentTitle = destMatch[1];
              console.log(`\n🎵 ${currentTitle}`);
            }
          }
          if (eventType === "ExtractAudio" || eventType === "Merger") {
            process.stdout.write(`\r🔄 Converting...                    `);
          }
        });

        ytDlpProcess.on("error", (error) => {
          console.error(`\n❌ Error: ${error.message}`);
          resolve(); // Continue with next link
        });

        ytDlpProcess.on("close", () => {
          console.log(`\n✅ Done!`);
          resolve();
        });
      });
    } catch (error) {
      console.error(`\n❌ An error occurred: ${error.message}`);
    }
  }
}

/**
 * Inspects a link to check if it's a playlist and get its title
 */
async function inspectLink(link) {
  const ytDlpWrap = new YTDlpWrap.default(YTDLP_PATH);

  try {
    const args = [
      link,
      "--flat-playlist",
      "--print", "%(playlist_title)s",
      "--playlist-items", "1",
      "--no-warnings",
    ];

    const stdout = await ytDlpWrap.execPromise(args);

    const title = stdout.trim();
    if (title && title !== "NA" && title !== link) {
      return title;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Parses command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    mediaType: null,
    quality: null,
    links: [],
  };

  for (const arg of args) {
    if (arg === "--video") {
      result.mediaType = "video";
      result.quality = "best";
    } else if (arg === "--audio") {
      result.mediaType = "audio";
      result.quality = "320";
    } else if (!arg.startsWith("-")) {
      result.links.push(arg);
    }
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  console.log("🎬 YouTube Downloader\n");
  
  await ensureYtDlp();

  const { mediaType: argMediaType, quality: argQuality, links: argLinks } = parseArgs();
  let links = argLinks;

  // If no links from args, try links file
  if (links.length === 0 && fs.existsSync(LINKS_FILE)) {
    const fileContent = fs.readFileSync(LINKS_FILE, "utf-8");
    links = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }

  if (links.length === 0) {
    console.log(
      `⚠️  No URL provided via arguments and no links found in '${LINKS_FILE}'.`
    );
    process.exit(1);
  }

  console.log("\nInspecting link...");
  const playlistTitle = await inspectLink(links[0]);
  
  if (playlistTitle) {
    console.log(`📋 Playlist detected: "${playlistTitle}"`);
  }

  let choices;
  if (argMediaType) {
    const outputDir = playlistTitle
      ? path.join(DOWNLOADS_DIR, sanitizeFilename(playlistTitle))
      : DOWNLOADS_DIR;

    choices = {
      mediaType: argMediaType,
      quality: argQuality,
      outputDir: outputDir,
    };
  } else {
    choices = await getUserChoices(playlistTitle);
  }
  
  const { mediaType, quality, outputDir } = choices;

  console.log(`\n🎬 Starting download...`);
  console.log(`   - Link(s): ${links.join(", ")}`);
  console.log(`   - Type: ${mediaType}`);
  console.log(`   - Quality: ${quality}`);
  console.log(`   - Destination: ${path.resolve(outputDir)}`);
  console.log("-".repeat(40));

  await downloadMedia(links, outputDir, mediaType, quality);

  console.log("\n🎉 All downloads are complete.");
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
