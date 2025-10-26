import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

// Filler words to remove (for now just "wait" for testing)
const FILLER_WORDS = [
  "uh",
  "um",
  "mhmm",
  "mm-mm",
  "uh-uh",
  "uh-huh",
  "nuh-uh",
  "wait",
];

export interface RemovedSegment {
  start: number;
  end: number;
}

export interface FillerRemovalResult {
  videoPath: string;
  removedSegments: RemovedSegment[];
}

export async function removeFillerWords(
  videoPath: string,
  transcript: SyncPrerecordedResponse
): Promise<FillerRemovalResult> {
  console.log("Removing filler words from video...");

  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];
  const removedSegments: RemovedSegment[] = [];

  // Find all filler words to remove
  for (const word of words) {
    if (
      word.word &&
      word.start !== undefined &&
      word.end !== undefined &&
      FILLER_WORDS.includes(word.word.toLowerCase())
    ) {
      removedSegments.push({
        start: word.start,
        end: word.end,
      });
    }
  }

  if (removedSegments.length === 0) {
    console.log("No filler words found, returning original video");
    return { videoPath, removedSegments: [] };
  }

  console.log(`Found ${removedSegments.length} filler words to remove`);

  // Build time ranges to KEEP (inverse of removed segments)
  const keepRanges: Array<{ start: number; end: number }> = [];
  let currentTime = 0;

  for (const segment of removedSegments) {
    if (segment.start > currentTime) {
      keepRanges.push({ start: currentTime, end: segment.start });
    }
    currentTime = segment.end;
  }

  // Add final segment (from last removed segment to end of video)
  keepRanges.push({ start: currentTime, end: 999999 });

  // Build select filter expression
  const conditions = keepRanges
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

  console.log(`Removing ${removedSegments.length} filler word segments...`);
  console.log(`Output will be saved to: ${outputPath}`);

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    console.log(`✅ Filler words removed successfully: ${outputPath}`);
    return { videoPath: outputPath, removedSegments };
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error(error.stderr?.toString());
    throw new Error(
      `FFmpeg filler removal failed: ${error.stderr?.toString()}`
    );
  }
}
