import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { Resource } from "sst";

export async function getCleanedTranscript(
  transcript: string
): Promise<string> {
  const anthropic = createAnthropic({
    apiKey: Resource.AnthropicApiKey.value,
  });

  const result = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    prompt: `You are a transcript editor. Your ONLY job is to remove filler words from the transcript.

CRITICAL RULES:
1. DO NOT change any words - only remove them
2. DO NOT fix grammar or spelling
3. DO NOT change contractions (keep "name's", "i'm", "we're" exactly as-is)
4. DO NOT add punctuation or capitalization
5. DO NOT rephrase or reword anything
6. ONLY delete complete words that are filler

Remove these filler words:
- um, uh, like (when filler), you know, sort of, kind of, basically, literally, actually, honestly, so (when filler), well, I mean, right, okay, yeah, wait, hmm
- Repeated words or stammering
- False starts or incomplete thoughts

Keep everything else EXACTLY as written, including:
- All contractions unchanged
- All word forms unchanged
- All capitalization and punctuation unchanged

Return ONLY the transcript with filler words removed. Do not modify anything else.

Transcript:
${transcript}`,
  });

  return result.text.trim();
}
