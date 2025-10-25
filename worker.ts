import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client();

export async function handler() {
  // Hardcoded file ID from S3
  const fileId = "3bf0960b-5391-4d17-85a0-1e8b10c759f6";

  // Download video from S3
  const downloadPath = path.join("/tmp", `${fileId}.mp4`);
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: fileId,
    })
  );

  const buffer = await response.Body!.transformToByteArray();
  await fs.writeFile(downloadPath, buffer);

  // Generate thumbnail
  const outputFile = "thumbnail.jpg";
  const outputPath = path.join("/tmp", outputFile);

  const ffmpegParams = [
    "-ss",
    "1",
    "-i",
    downloadPath,
    "-vf",
    "thumbnail,scale=960:540",
    "-vframes",
    "1",
    outputPath,
  ];

  spawnSync(ffmpeg, ffmpegParams, { stdio: "pipe" });

  // Upload thumbnail to S3
  const img = await fs.readFile(outputPath);
  const resultKey = `results/${crypto.randomUUID()}.jpg`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: resultKey,
      Body: img,
      ContentType: "image/jpeg",
    })
  );

  // Generate presigned URL for the uploaded thumbnail
  const resultUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: resultKey,
    }),
    { expiresIn: 3600 } // 1 hour
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ url: resultUrl }),
    headers: {
      "Content-Type": "application/json",
    },
  };
}
