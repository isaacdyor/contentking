import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client();

export async function createVideo(fileIds: string[]): Promise<Buffer> {
  console.log("Starting video creation for files:", fileIds);

  // Download all videos from S3
  const videoFiles: string[] = [];
  for (const fileId of fileIds) {
    const downloadPath = path.join("/tmp", `${fileId}.mp4`);
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME!,
        Key: `uploads/${fileId}.mp4`,
      })
    );

    const buffer = await response.Body!.transformToByteArray();
    await fs.writeFile(downloadPath, buffer);
    videoFiles.push(downloadPath);
    console.log("Downloaded:", fileId);
  }

  // Concatenate videos using ffmpeg concat filter
  // Scale all videos to 1920x1080 and set to 30fps before concatenating
  const outputPath = path.join("/tmp", `output-${Date.now()}.mp4`);

  // Build input arguments: -i file1 -i file2 -i file3...
  const inputArgs: string[] = [];
  for (const file of videoFiles) {
    inputArgs.push("-i", file);
  }

  // Build filter complex: scale each video to same resolution and fps, then concat
  const scaleFilters = videoFiles
    .map(
      (_, i) =>
        `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    )
    .join(";");
  const concatInputs = videoFiles.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${scaleFilters};${concatInputs}concat=n=${videoFiles.length}:v=1:a=0[outv]`;

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
