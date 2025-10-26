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
  // Scale all videos to 1920x1080 and set to 30fps before concatenating
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
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
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
  return outputPath;
}
