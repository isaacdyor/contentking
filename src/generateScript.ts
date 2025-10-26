import { generateObject, generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Resource } from "sst";
import { exa } from "./exaClient";
import z from "zod";
import { getScriptSystemPrompt } from "./scriptSystemPrompt";
import { getDeepgramClient } from "./deepgramClient";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import path from "path";

const s3 = new S3Client();

export async function generateScript(linkedinUrl: string, fileId: string): Promise<string> {
  // Download the audio file from S3 to /tmp
  const filename = fileId.split("/").pop()!;
  const tempPath = path.join("/tmp", filename);

  const response = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: fileId,
    })
  );

  const buffer = await response.Body!.transformToByteArray();
  await writeFile(tempPath, buffer);

  let hotTake: string;
  try {
    const deepgramClient = getDeepgramClient();
    const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
      createReadStream(tempPath),
      {
        model: "nova-3",
        smart_format: true,
        filler_words: true,
      }
    );

    if (error) {
      throw new Error(`Deepgram transcription failed: ${JSON.stringify(error)}`);
    }

    const channel = result.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];

    if (!alternative?.transcript) {
      throw new Error("No transcription result");
    }

    hotTake = alternative.transcript;
  } finally {
    // Clean up temp file
    await unlink(tempPath).catch(() => {});
  }

  // Now generate the script with the transcribed hot take
  const result = await exa.getContents([linkedinUrl], {
    text: true,
  });

  const linkedinContent = result.results[0]?.text;

  const anthropic = createAnthropic({
    apiKey: Resource.AnthropicApiKey.value,
  });

  const systemPrompt = getScriptSystemPrompt(linkedinContent, hotTake);

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-5-20250929"),
    system: systemPrompt,
    prompt: "Generate the script based on the LinkedIn profile and hot take.",
    schema: z.object({
      script: z.string(),
    }),
  });

  return object.script;
}
