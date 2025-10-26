import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";
import { diffArrays } from "diff";
import { getCleanedTranscript } from "./getCleanedTranscript";
import {
  invertSegmentsToKeep,
  generateOutputPath,
  type Segment,
} from "./utils/ffmpegHelpers";

export async function removeFillerWords(
  videoPath: string,
  transcript: SyncPrerecordedResponse
): Promise<string> {
  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];

  // Build original transcript text and get cleaned version from LLM
  const originalText = words.map((w) => w.word).join(" ");
  const cleanedText = await getCleanedTranscript(originalText);

  // Strip punctuation for comparison
  const stripPunctuation = (word: string) => word.replace(/[.,!?;:'"]/g, "");
  const originalWords = words.map((w) =>
    stripPunctuation(w.word?.toLowerCase() || "")
  );
  const cleanedWords = cleanedText
    .toLowerCase()
    .split(/\s+/)
    .map(stripPunctuation);

  // Diff to find which word indices to remove
  const diff = diffArrays(originalWords, cleanedWords);
  const removedIndices = new Set<number>();
  let originalIndex = 0;

  for (const part of diff) {
    if (part.removed) {
      for (let i = 0; i < (part.value?.length || 0); i++) {
        removedIndices.add(originalIndex);
        originalIndex++;
      }
    } else if (!part.added) {
      originalIndex += part.value?.length || 0;
    }
  }

  // Build removed segments from indices
  const removedSegments: Segment[] = [];
  for (const index of removedIndices) {
    const word = words[index];
    if (word.start !== undefined && word.end !== undefined) {
      removedSegments.push({
        start: word.start,
        end: word.end,
      });
    }
  }

  if (removedSegments.length === 0) {
    return videoPath;
  }

  // Sort filler segments by start time
  removedSegments.sort((a, b) => a.start - b.start);

  // Invert to get segments to keep
  const keptSegments = invertSegmentsToKeep(removedSegments);

  // Build select filter to keep non-filler segments
  const conditions = keptSegments
    .map((range) => `between(t,${range.start},${range.end})`)
    .join("+");

  const filterComplex = `[0:v]select='${conditions}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${conditions}',asetpts=N/SR/TB[a]`;

  // Generate output path
  const outputPath = generateOutputPath(videoPath, "no_fillers");

  // Run ffmpeg
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -y "${outputPath}"`;

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg filler removal failed: ${error.stderr?.toString()}`);
    throw new Error(
      `FFmpeg filler removal failed: ${error.stderr?.toString()}`
    );
  }
}
