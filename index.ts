import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const s3 = new S3Client();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const lambdaClient = new LambdaClient();

const app = new Hono();

// Schemas
const uploadSchema = z.object({
  count: z.number().min(1),
});

const processSchema = z.object({
  fileIds: z.array(z.string()),
});

// POST /upload - Generate presigned URLs for multiple files
app.post("/upload", zValidator("json", uploadSchema), async (c) => {
  const body = c.req.valid("json");

  const uploads = await Promise.all(
    Array.from({ length: body.count }, async () => {
      const fileId = crypto.randomUUID();
      const command = new PutObjectCommand({
        Key: fileId,
        Bucket: process.env.BUCKET_NAME!,
        ContentType: "video/mp4",
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

      return { fileId, uploadUrl };
    })
  );

  return c.json({ uploads });
});

// POST /process - Start video processing job
app.post("/process", zValidator("json", processSchema), async (c) => {
  const body = c.req.valid("json");
  const jobId = crypto.randomUUID();

  // Create DynamoDB job entry
  await dynamoClient.send(
    new PutCommand({
      TableName: process.env.TABLE_NAME!,
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
      FunctionName: process.env.WORKER_FUNCTION_NAME!,
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
      TableName: process.env.TABLE_NAME!,
      Key: { jobId },
    })
  );

  if (!result.Item) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(result.Item);
});

export const handler = handle(app);
