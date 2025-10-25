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
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());

interface WorkerEvent {
  jobId: string;
  fileIds: string[];
}

export async function handler(event: WorkerEvent) {
  const { jobId, fileIds } = event;

  try {
    console.log("Starting processing for job:", jobId);

    // Download all videos from S3
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
      console.log("Downloaded:", fileId);
    }

    // Create file list for ffmpeg concat
    const fileListPath = path.join("/tmp", "filelist.txt");
    const fileListContent = videoFiles
      .map((file) => `file '${file}'`)
      .join("\n");
    await fs.writeFile(fileListPath, fileListContent);

    // Concatenate videos using ffmpeg
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

    console.log("Running ffmpeg...");
    const result = spawnSync(ffmpeg!, ffmpegParams, { stdio: "pipe" });

    if (result.status !== 0) {
      throw new Error(
        `ffmpeg failed: ${result.stderr?.toString() || "Unknown error"}`
      );
    }

    // Upload concatenated video to S3
    const video = await fs.readFile(outputPath);
    const resultKey = `results/${jobId}.mp4`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_NAME!,
        Key: resultKey,
        Body: video,
        ContentType: "video/mp4",
      })
    );

    // Generate presigned URL for the result
    const resultUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: process.env.BUCKET_NAME!,
        Key: resultKey,
      }),
      { expiresIn: 3600 }
    );

    console.log("Uploaded result:", resultUrl);

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

    console.log("Job completed:", jobId);
    return { success: true, jobId, resultUrl };
  } catch (error) {
    console.error("Job failed:", jobId, error);

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
}
