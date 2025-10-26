import { generateObject, generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Resource } from "sst";
import { exa } from "./exaClient";
import z from "zod";
import { getScriptSystemPrompt } from "./scriptSystemPrompt";

export async function generateScript(linkedinUrl: string, hotTake: string): Promise<string> {
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
