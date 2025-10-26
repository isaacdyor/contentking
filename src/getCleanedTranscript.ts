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
    prompt: `You are a strict transcript editor. Your job is to aggressively remove ALL filler words and any words that do not contribute to the core message or grammatical correctness of the transcript.

Remove:
- ALL filler words: um, uh, like, you know, sort of, kind of, basically, literally, actually, honestly, so, well, I mean, right, okay, yeah, wait, hmm, etc.
- Repeated words or stammering
- False starts or incomplete thoughts
- ANY word that doesn't drive the story forward or contribute to grammatical correctness

Keep ONLY:
- Words that convey the core message
- Words necessary for grammatical structure
- Technical terms, names, and specific details

Be STRICT. When in doubt, remove it. The goal is a clean, concise transcript with zero fluff.

Return ONLY the cleaned transcript text with no explanations or formatting.

Transcript:
${transcript}`,
  });

  return result.text.trim();
}
