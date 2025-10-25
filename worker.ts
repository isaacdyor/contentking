import path from "path";
import ffmpeg from "ffmpeg-static";
import { promises as fs } from "fs";
import { spawnSync } from "child_process";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());

interface WorkerEvent {
  jobId: string;
  fileIds: string[];
}

export const handler = async (event: WorkerEvent) => {
  const { jobId, fileIds } = event;

  try {
    // Download all videos from S3 to /tmp
    const videoFiles: string[] = [];
    for (const fileId of fileIds) {
      const downloadPath = path.join("/tmp", `${fileId}.mp4`);

      const response = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.BUCKET_NAME!,
          Key: fileId,
        })
      );

      const buffer = await response.Body!.transformToByteArray();
      await fs.writeFile(downloadPath, buffer);
      videoFiles.push(downloadPath);
    }

    // Create file list for ffmpeg concat
    const fileListPath = path.join("/tmp", "filelist.txt");
    const fileListContent = videoFiles
      .map((file) => `file '${file}'`)
      .join("\n");
    await fs.writeFile(fileListPath, fileListContent);

    // Stitch videos using ffmpeg
    const outputPath = path.join("/tmp", `${jobId}.mp4`);
    const ffmpegParams = [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      fileListPath,
      "-c",
      "copy",
      outputPath,
    ];

    const result = spawnSync(ffmpeg!, ffmpegParams, { stdio: "pipe" });

    if (result.status !== 0) {
      throw new Error(
        `ffmpeg failed: ${result.stderr?.toString() || "Unknown error"}`
      );
    }

    // Upload result to S3
    const resultBuffer = await fs.readFile(outputPath);
    const resultKey = `results/${jobId}.mp4`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME!,
        Key: resultKey,
        Body: resultBuffer,
        ContentType: "video/mp4",
      })
    );

    const resultUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${resultKey}`;

    // Update DynamoDB job to completed
    await dynamoClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME!,
        Key: { jobId },
        UpdateExpression:
          "SET #status = :status, resultUrl = :resultUrl, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "completed",
          ":resultUrl": resultUrl,
          ":updatedAt": Date.now(),
        },
      })
    );

    // Cleanup /tmp files
    await Promise.all(
      videoFiles.map((file) => fs.unlink(file).catch(() => {}))
    );
    await fs.unlink(fileListPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});

    return { success: true, jobId, resultUrl };
  } catch (error) {
    // Update DynamoDB job to failed
    await dynamoClient.send(
      new UpdateCommand({
        TableName: process.env.TABLE_NAME!,
        Key: { jobId },
        UpdateExpression:
          "SET #status = :status, errorMessage = :errorMessage, updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": "failed",
          ":errorMessage":
            error instanceof Error ? error.message : "Unknown error",
          ":updatedAt": Date.now(),
        },
      })
    );

    throw error;
  }
};
