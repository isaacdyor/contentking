import { getDeepgramClient } from "./deepgramClient";
import { writeFile, unlink } from "fs/promises";
import { createReadStream } from "fs";
import type { Context } from "hono";

export async function simpleS2T(c: Context) {
  try {
    const body = await c.req.parseBody();
    const file = body["audio"];

    if (!file || typeof file === "string") {
      return c.json({ error: "No audio file provided" }, 400);
    }

    // Save file to /tmp for processing
    const tempPath = `/tmp/${crypto.randomUUID()}.${file.name.split(".").pop() || "mp3"}`;
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(tempPath, Buffer.from(arrayBuffer));

    try {
      // Transcribe using Deepgram
      const deepgramClient = getDeepgramClient();
      const { result, error } =
        await deepgramClient.listen.prerecorded.transcribeFile(
          createReadStream(tempPath),
          {
            model: "nova-3",
            smart_format: true,
            filler_words: true,
          }
        );

      if (error) {
        throw new Error(`Deepgram transcription failed: ${error.message}`);
      }

      // Extract transcript data
      const channel = result.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];

      if (!alternative) {
        throw new Error("No transcription result");
      }

      const response = {
        transcript: alternative.transcript,
        words: alternative.words?.map((w) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
        })),
        metadata: {
          duration: result.metadata?.duration || 0,
          channels: result.metadata?.channels || 0,
        },
      };

      return c.json(response);
    } finally {
      // Clean up temp file
      await unlink(tempPath).catch(() => {});
    }
  } catch (error) {
    console.error("Transcription error:", error);
    return c.json(
      {
        error: "Transcription failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
