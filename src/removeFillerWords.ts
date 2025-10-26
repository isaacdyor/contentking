import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";
import { diffArrays } from "diff";
import { getCleanedTranscript } from "./getCleanedTranscript";

export interface RemovedSegment {
  start: number;
  end: number;
}

export async function removeFillerWords(
  videoPath: string,
  transcript: SyncPrerecordedResponse
): Promise<string> {
  console.log("Removing filler words from video...");

  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];

  // Build original transcript text
  const originalText = words.map((w) => w.word).join(" ");

  // Get cleaned transcript from LLM
  console.log("Getting cleaned transcript from LLM...");
  const cleanedText = await getCleanedTranscript(originalText);

  // Helper to strip punctuation
  const stripPunctuation = (word: string) => word.replace(/[.,!?;:'"]/g, "");

  // Split into word arrays (strip punctuation for comparison)
  const originalWords = words.map((w) => stripPunctuation(w.word?.toLowerCase() || ""));
  console.log("ORIGINAL WORDS 🔥\n", originalWords);
  const cleanedWords = cleanedText.toLowerCase().split(/\s+/).map(stripPunctuation);
  console.log("CLEANED WORDS 🔥\n", cleanedWords);

  // Diff to find removed words
  const diff = diffArrays(originalWords, cleanedWords);
  console.log("DIFF 🔥\n", diff);
  // Track which word indices to remove
  const removedIndices = new Set<number>();
  let originalIndex = 0;

  for (const part of diff) {
    if (part.removed) {
      // These words exist in original but not in cleaned
      for (let i = 0; i < (part.value?.length || 0); i++) {
        removedIndices.add(originalIndex);
        originalIndex++;
      }
    } else if (!part.added) {
      // These words exist in both (no change)
      originalIndex += part.value?.length || 0;
    }
    // Skip added parts (shouldn't happen in our case)
  }

  console.log("REMOVED INDICES 🔥\n", Array.from(removedIndices));

  // Build removed segments from indices
  const removedSegments: RemovedSegment[] = [];
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
    console.log("No filler words found, returning original video");
    return videoPath;
  }

  console.log(`Found ${removedSegments.length} filler words to remove`);

  // Sort filler segments by start time
  removedSegments.sort((a, b) => a.start - b.start);

  // Build segments to KEEP (non-filler segments)
  const keptSegments: RemovedSegment[] = [];
  let currentTime = 0;

  for (const fillerSegment of removedSegments) {
    if (fillerSegment.start > currentTime) {
      keptSegments.push({
        start: currentTime,
        end: fillerSegment.start,
      });
    }
    currentTime = fillerSegment.end;
  }

  // Add final segment from last filler to end of video
  keptSegments.push({ start: currentTime, end: 999999 });

  // Build select filter to keep non-filler segments
  const conditions = keptSegments
    .map((range) => `between(t,${range.start},${range.end})`)
    .join("+");

  const filterComplex = `[0:v]select='${conditions}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${conditions}',asetpts=N/SR/TB[a]`;

  // Generate output path
  const parsedPath = path.parse(videoPath);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_no_fillers${parsedPath.ext}`
  );

  // Run ffmpeg
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -y "${outputPath}"`;

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    console.log(`✅ Filler words removed successfully: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error(error.stderr?.toString());
    throw new Error(
      `FFmpeg filler removal failed: ${error.stderr?.toString()}`
    );
  }
}
