import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "fs";

const s3 = new S3Client();

export async function uploadVideoToS3(
  videoPath: string,
  key: string
): Promise<string> {
  const fileBuffer = await fs.readFile(videoPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: key,
      Body: fileBuffer,
      ContentType: "video/mp4",
    })
  );

  const presignedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: key,
    }),
    { expiresIn: 3600 }
  );

  return presignedUrl;
}
