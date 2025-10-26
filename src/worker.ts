import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createVideo } from "./createVideo";
import { uploadVideoToS3 } from "./uploadToS3";
import path from "path";
import { promises as fs } from "fs";
import * as fsSync from "node:fs";

// ---- Fontconfig bootstrap ----
const fontsDir = path.join(process.cwd(), "fonts");
const fontsConf = path.join(fontsDir, "fonts.conf");

// Make sure cache dir exists
fsSync.mkdirSync("/tmp/fontconfig", { recursive: true });

// Set env vars so libass/fontconfig initialize correctly
process.env.FONTCONFIG_PATH = fontsDir;
process.env.FONTCONFIG_FILE = fontsConf;
process.env.XDG_CACHE_HOME = "/tmp";
process.env.HOME = "/tmp";
// -------------------------------

const s3 = new S3Client();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());

interface WorkerEvent {
  jobId: string;
  keys: string[];
}

export async function handler(event: WorkerEvent) {
  console.log("==== Environment sanity check ====");
  console.log("CWD:", process.cwd()); // should be /var/task in Lambda
  console.log("Node version:", process.version);
  console.log("Platform:", process.platform, process.arch);

  // Confirm font environment variables
  console.log("FONTCONFIG_PATH:", process.env.FONTCONFIG_PATH);
  console.log("FONTCONFIG_FILE:", process.env.FONTCONFIG_FILE);
  console.log("XDG_CACHE_HOME:", process.env.XDG_CACHE_HOME);
  console.log("HOME:", process.env.HOME);

  // Confirm the fonts directory exists and is readable
  const fontsDir = path.join(process.cwd(), "fonts");
  console.log("Fonts dir exists:", fsSync.existsSync(fontsDir));
  if (fsSync.existsSync(fontsDir)) {
    console.log("Fonts:", fsSync.readdirSync(fontsDir));
  }

  // Confirm /tmp/fontconfig (cache dir) exists & is writable
  const cacheDir = "/tmp/fontconfig";
  try {
    fsSync.mkdirSync(cacheDir, { recursive: true });
    const testFile = path.join(cacheDir, "write_test");
    fsSync.writeFileSync(testFile, "ok");
    fsSync.unlinkSync(testFile);
    console.log("Cache dir writable:", true);
  } catch (err) {
    console.log("Cache dir writable:", false, err);
  }

  console.log("==== End sanity check ====");
  const { jobId, keys } = event;

  try {
    console.log("Starting processing for job:", jobId);

    // Download all videos from S3
    const videoFilePaths: string[] = [];
    for (const key of keys) {
      const filename = key.split("/").pop()!;
      const downloadPath = path.join("/tmp", filename);
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: process.env.BUCKET_NAME!,
          Key: key,
        })
      );

      const buffer = await response.Body!.transformToByteArray();
      await fs.writeFile(downloadPath, buffer);
      videoFilePaths.push(downloadPath);
      console.log("Downloaded:", key);
    }

    // Create the concatenated video
    const videoPath = await createVideo(videoFilePaths, jobId);

    // Upload concatenated video to S3 and get presigned URL
    const resultUrl = await uploadVideoToS3(videoPath, `results/${jobId}.mp4`);

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
