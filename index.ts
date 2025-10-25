import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

const app = new Hono();

app.get("/frame", async (c) => {
  const videoPath = "clip.mp4";

  const outputFile = "thumbnail.jpg";
  const outputPath = process.env.SST_DEV
    ? outputFile
    : path.join("/tmp", outputFile);

  const ffmpegParams = [
    "-ss",
    "1",
    "-i",
    videoPath,
    "-vf",
    "thumbnail,scale=960:540",
    "-vframes",
    "1",
    outputPath,
  ];

  spawnSync(ffmpeg!, ffmpegParams, { stdio: "pipe" });

  const img = await fs.readFile(outputPath);

  c.header("Content-Type", "image/jpeg");
  c.header("Content-Disposition", "inline");

  return c.body(img);
});

app.get("/upload", async (c) => {
  const command = new PutObjectCommand({
    Key: crypto.randomUUID(),
    Bucket: process.env.BUCKET_NAME,
  });

  return c.text(await getSignedUrl(s3, command));
});

app.get("/list", async (c) => {
  const objects = await s3.send(
    new ListObjectsV2Command({
      Bucket: process.env.BUCKET_NAME,
    })
  );

  return c.json(objects.Contents);
});

export const handler = handle(app);
