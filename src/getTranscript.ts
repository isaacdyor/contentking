import { createReadStream } from "fs";
import { getDeepgramClient } from "./deepgramClient";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

export async function getTranscript(
  videoPath: string
): Promise<SyncPrerecordedResponse> {
  const deepgramClient = getDeepgramClient();
  const { result, error } =
    await deepgramClient.listen.prerecorded.transcribeFile(
      createReadStream(videoPath),
      {
        model: "nova-3",
        smart_format: true,
        filler_words: true,
      }
    );

  if (error) {
    throw new Error(`Deepgram transcription failed: ${error.message}`);
  }

  return result;
}
