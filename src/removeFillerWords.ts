import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

// Filler words to remove (for now just "wait" for testing)
const FILLER_WORDS = ["uh", "um", "mhmm", "mm-mm", "uh-uh", "uh-huh", "nuh-uh"];

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
  const removedSegments: RemovedSegment[] = [];

  console.log(`\n📝 Total words in transcript: ${words.length}`);
  console.log(`🎯 Filler words to check: ${FILLER_WORDS.join(", ")}\n`);

  // Find all filler words to remove
  for (const word of words) {
    const wordLower = word.word?.toLowerCase();
    const isFiller = FILLER_WORDS.includes(wordLower || "");

    console.log(
      `Word: "${word.word}" (lowercase: "${wordLower}") | ` +
        `start: ${word.start} | end: ${word.end} | ` +
        `isFiller: ${isFiller}`
    );

    if (
      word.word &&
      word.start !== undefined &&
      word.end !== undefined &&
      FILLER_WORDS.includes(word.word.toLowerCase())
    ) {
      console.log(
        `  ✂️  REMOVING: "${word.word}" at ${word.start}-${word.end}`
      );
      removedSegments.push({
        start: word.start,
        end: word.end,
      });
    }
  }

  console.log(`\n📊 Total filler words found: ${removedSegments.length}`);

  if (removedSegments.length === 0) {
    console.log("No filler words found, returning original video");
    return videoPath;
  }

  console.log(`Found ${removedSegments.length} filler words to remove`);

  // Sort filler segments by start time
  removedSegments.sort((a, b) => a.start - b.start);

  console.log("\n🗑️  Filler word segments to remove:");
  removedSegments.forEach((seg, i) => {
    console.log(
      `  ${i + 1}. ${seg.start}s - ${seg.end}s (duration: ${(
        seg.end - seg.start
      ).toFixed(2)}s)`
    );
  });

  // Build segments to KEEP (non-filler segments)
  const keptSegments: RemovedSegment[] = [];
  let currentTime = 0;

  for (const fillerSegment of removedSegments) {
    if (fillerSegment.start > currentTime) {
      keptSegments.push({
        start: currentTime,
        end: fillerSegment.start
      });
    }
    currentTime = fillerSegment.end;
  }

  // Add final segment from last filler to end of video
  keptSegments.push({ start: currentTime, end: 999999 });

  console.log("\n✅ Segments to KEEP (non-filler content):");
  keptSegments.forEach((seg, i) => {
    const duration = seg.end === 999999 ? 'end' : (seg.end - seg.start).toFixed(2) + 's';
    console.log(`  ${i + 1}. ${seg.start}s - ${seg.end}s (duration: ${duration})`);
  });

  // Build select filter to keep non-filler segments
  const conditions = keptSegments
    .map((range) => `between(t,${range.start},${range.end})`)
    .join("+");

  const filterComplex = `[0:v]select='${conditions}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${conditions}',asetpts=N/SR/TB[a]`;

  console.log(`\n🎬 FFmpeg filter: ${filterComplex}`);

  // Generate output path
  const parsedPath = path.parse(videoPath);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_no_fillers${parsedPath.ext}`
  );

  // Run ffmpeg
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -filter_complex "${filterComplex}" -map "[v]" -map "[a]" -y "${outputPath}"`;

  console.log(`\nRemoving ${removedSegments.length} filler word segments...`);
  console.log(`Full FFmpeg command:\n${ffmpegCmd}`);
  console.log(`Output will be saved to: ${outputPath}`);

  try {
    const result = execSync(ffmpegCmd, { encoding: "utf8", stdio: "pipe" });
    console.log(`✅ Filler words removed successfully: ${outputPath}`);
    console.log(`FFmpeg output: ${result}`);
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error(`FFmpeg stdout: ${error.stdout?.toString()}`);
    console.error(`FFmpeg stderr: ${error.stderr?.toString()}`);
    throw new Error(
      `FFmpeg filler removal failed: ${error.stderr?.toString()}`
    );
  }
}
