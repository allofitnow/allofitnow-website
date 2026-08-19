/* Shared video → web-mp4 transcode (ffmpeg). One preset, used by BOTH the Media upload
 * hook (collections/Media.ts, auto-optimizes new uploads) and the one-time migration
 * (scripts/optimize-existing-videos.js). CommonJS so the .ts hook and the .js script can
 * both require it. Requires ffmpeg on the host (PATH).
 *
 * Preset rationale (muted, looping gallery "moving stills"):
 *   - scale to <=1280w (720p-class) — gallery clips never need more; keeps aspect (-2 = even h).
 *   - H.264 High / yuv420p — HARDWARE-decoded everywhere incl iOS Safari (VP9/webm is
 *     software-decoded on iPhone → the "forever to load in" jank). Universal <video> support.
 *   - crf 26 / preset slow — strong compression, visually ~identical for motion loops.
 *   - -an — strip audio (they're muted anyway).
 *   - +faststart — moov atom up front so playback starts before the file finishes downloading.
 */
const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const execFileP = promisify(execFile);

const FF_ARGS = (inPath, outPath) => [
  "-y", "-i", inPath,
  "-vf", "scale='min(1280,iw)':-2:flags=lanczos",
  "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-crf", "26", "-preset", "slow",
  "-movflags", "+faststart", "-an", "-r", "30",
  outPath,
];

// Transcode one file on disk → outPath. Throws on ffmpeg failure.
async function transcodeFile(inPath, outPath) {
  await execFileP("ffmpeg", FF_ARGS(inPath, outPath), {
    timeout: 15 * 60 * 1000, // 15 min ceiling per clip
    maxBuffer: 1 << 24,
  });
}

// Buffer in → mp4 Buffer out (used by the upload hook). Uses temp files since ffmpeg
// needs seekable I/O. Throws so the caller can fall back to the original upload.
async function transcodeBuffer(buffer, ext = ".webm") {
  const base = path.join(
    os.tmpdir(),
    `aoin_vid_${process.pid}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  );
  const inPath = base + (ext && ext.startsWith(".") ? ext : ".webm");
  const outPath = base + ".mp4";
  try {
    await fs.writeFile(inPath, buffer);
    await transcodeFile(inPath, outPath);
    return await fs.readFile(outPath);
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

module.exports = { transcodeFile, transcodeBuffer, FF_ARGS };
