import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";

export async function createVideo(videoFilePaths: string[]): Promise<Buffer> {
  console.log("Starting video creation for files:", videoFilePaths);

  // Concatenate videos using ffmpeg concat filter
  // Scale all videos to 1920x1080 and set to 30fps before concatenating
  const outputPath = path.join("/tmp", `output-${Date.now()}.mp4`);

  // Build input arguments: -i file1 -i file2 -i file3...
  const inputArgs: string[] = [];
  for (const file of videoFilePaths) {
    inputArgs.push("-i", file);
  }

  // Build filter complex: scale each video to same resolution and fps, then concat
  const scaleFilters = videoFilePaths
    .map(
      (_, i) =>
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    )
    .join(";");
  const concatInputs = videoFilePaths.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${scaleFilters};${concatInputs}concat=n=${videoFilePaths.length}:v=1:a=0[outv]`;

  const ffmpegParams = [
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p", // Ensure compatible pixel format for all players
    "-movflags",
    "+faststart", // Enable streaming/progressive download
    "-an", // No audio
    outputPath,
  ];

  console.log("Running ffmpeg...");
  console.log("FFmpeg params:", JSON.stringify(ffmpegParams));
  const result = spawnSync(ffmpeg!, ffmpegParams, { stdio: "pipe" });

  console.log("FFmpeg exit code:", result.status);
  console.log("FFmpeg stderr:", result.stderr?.toString());

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "Unknown error";
    console.error("FFmpeg failed with stderr:", stderr);
    throw new Error(`ffmpeg failed with exit code ${result.status}`);
  }

  // Read the output video
  const video = await fs.readFile(outputPath);
  console.log("Video created successfully, size:", video.length, "bytes");

  return video;
}
