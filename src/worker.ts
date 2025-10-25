import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createVideo } from "./createVideo";

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

    // Create the concatenated video
    const video = await createVideo(fileIds);

    // Upload concatenated video to S3
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
