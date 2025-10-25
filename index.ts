import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { Resource } from "sst";

const s3 = new S3Client();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const lambdaClient = new LambdaClient();

const app = new Hono();

// POST /upload - Generate presigned URLs for multiple files
app.post("/upload", async (c) => {
  const body = await c.req.json<{
    files: { filename: string; contentType?: string }[];
  }>();

  const uploads = await Promise.all(
    body.files.map(async (file) => {
      const fileId = crypto.randomUUID();
      const command = new PutObjectCommand({
        Key: fileId,
        Bucket: Resource.MyBucket.name,
        ContentType: file.contentType || "video/mp4",
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

      return { fileId, uploadUrl };
    })
  );

  return c.json({ uploads });
});

// POST /process - Start video processing job
app.post("/process", async (c) => {
  const body = await c.req.json<{ fileIds: string[] }>();
  const jobId = crypto.randomUUID();

  // Create DynamoDB job entry
  await dynamoClient.send(
    new PutCommand({
      TableName: Resource.ProcessingJobs.name,
      Item: {
        jobId,
        status: "processing",
        fileIds: body.fileIds,
        createdAt: Date.now(),
      },
    })
  );

  // Invoke worker Lambda asynchronously
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: Resource.WorkerFunction.name,
      InvocationType: "Event", // Async invocation
      Payload: JSON.stringify({ jobId, fileIds: body.fileIds }),
    })
  );

  return c.json({ jobId, status: "processing" });
});

// GET /status/:jobId - Check job status
app.get("/status/:jobId", async (c) => {
  const jobId = c.req.param("jobId");

  const result = await dynamoClient.send(
    new GetCommand({
      TableName: Resource.ProcessingJobs.name,
      Key: { jobId },
    })
  );

  if (!result.Item) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(result.Item);
});

export const handler = handle(app);
