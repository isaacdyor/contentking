import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import { editVideoClip } from "./editVideoClip";

export async function createVideo(
  videoFilePaths: string[],
  jobId: string
): Promise<string> {
  console.log("Starting video creation for files:", videoFilePaths);

  // Edit all video clips in parallel
  const editedPaths = await Promise.all(
    videoFilePaths.map((path, index) =>
      editVideoClip(path, `${jobId}-clip${index}`)
    )
  );

  // Concatenate videos using ffmpeg concat filter
  // Scale all videos to 1080x1920 (vertical format) and set to 30fps before concatenating
  const outputPath = path.join("/tmp", `output-${Date.now()}.mp4`);

  // Build input arguments: -i file1 -i file2 -i file3...
  const inputArgs: string[] = [];
  for (const file of editedPaths) {
    inputArgs.push("-i", file);
  }

  // Build filter complex: scale each video to same resolution and fps, process audio, then concat
  const filters = editedPaths
    .map(
      (_, i) =>
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
    )
    .join(";");
  const concatInputs = editedPaths.map((_, i) => `[v${i}][a${i}]`).join("");
  const filterComplex = `${filters};${concatInputs}concat=n=${editedPaths.length}:v=1:a=1[outv][outa]`;

  const ffmpegParams = [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p", // Ensure compatible pixel format for all players
    "-movflags",
    "+faststart", // Enable streaming/progressive download
    outputPath,
  ];

  console.log("Running ffmpeg...");
  const result = spawnSync(ffmpeg!, ffmpegParams, { stdio: "pipe" });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "Unknown error";
    console.error("FFmpeg failed with stderr:", stderr);
    throw new Error(`ffmpeg failed with exit code ${result.status}`);
  }

  console.log("Video created successfully at:", outputPath);

  // Add background music
  const musicPath = path.join(
    process.cwd(),
    "music",
    "TKANDZ - Now Or Never (Heavenly Audio) Instrumental W Sample 🔥.mp3"
  );
  const finalOutputPath = path.join("/tmp", `final-output-${Date.now()}.mp4`);

  console.log("Adding background music from:", musicPath);
  console.log("Music file exists:", await fs.access(musicPath).then(() => true).catch(() => false));

  const musicParams = [
    "-i",
    outputPath, // video with original audio
    "-stream_loop",
    "-1", // loop music indefinitely
    "-i",
    musicPath, // background music
    "-filter_complex",
    "[1:a]volume=0.15[music];[0:a][music]amix=inputs=2:duration=shortest[aout]", // mix at 15% volume
    "-map",
    "0:v", // video from first input
    "-map",
    "[aout]", // mixed audio
    "-c:v",
    "copy", // don't re-encode video (faster)
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest", // stop when video ends
    finalOutputPath,
  ];

  console.log("Running ffmpeg to add background music...");
  const musicResult = spawnSync(ffmpeg!, musicParams, { stdio: "pipe" });

  if (musicResult.status !== 0) {
    const stderr = musicResult.stderr?.toString() || "Unknown error";
    console.error("FFmpeg music mixing failed with stderr:", stderr);
    throw new Error(
      `ffmpeg music mixing failed with exit code ${musicResult.status}`
    );
  }

  // Clean up intermediate file
  await fs.unlink(outputPath);

  console.log("Video with background music created at:", finalOutputPath);
  return finalOutputPath;
}
