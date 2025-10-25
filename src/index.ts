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
  filenames: z.array(z.string()),
});

const processSchema = z.object({
  keys: z.array(z.string()),
});

// Helper to get content type from extension
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  const contentTypes: Record<string, string> = {
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
  };
  return contentTypes[ext || ''] || 'video/mp4';
}

// POST /upload - Generate presigned URLs for multiple files
app.post("/upload", zValidator("json", uploadSchema), async (c) => {
  const body = c.req.valid("json");

  const uploads = await Promise.all(
    body.filenames.map(async (filename) => {
      const fileId = crypto.randomUUID();
      const ext = filename.split('.').pop() || 'mp4';
      const command = new PutObjectCommand({
        Key: `uploads/${fileId}.${ext}`,
        Bucket: process.env.BUCKET_NAME!,
        ContentType: getContentType(filename),
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      const key = `uploads/${fileId}.${ext}`;

      return { key, uploadUrl };
    })
  );

  return c.json(uploads);
});

// POST /process - Start video processing
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
        keys: body.keys,
        createdAt: Date.now(),
      },
    })
  );

  // Invoke worker Lambda asynchronously
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.WORKER_FUNCTION_NAME!,
      InvocationType: "Event", // Async invocation
      Payload: JSON.stringify({ jobId, keys: body.keys }),
    })
  );

  return c.json({ jobId });
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
