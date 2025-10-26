import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

interface SubtitleChunk {
  text: string;
  start: number;
  end: number;
}

function transcriptToSubtitles(
  transcript: SyncPrerecordedResponse,
  speedFactor: number
): SubtitleChunk[] {
  // Extract word-level timing from Deepgram transcript
  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];
  const chunks: SubtitleChunk[] = [];

  // Group words intelligently based on word length
  let currentChunk: { text: string[]; start: number; end: number } | null = null;

  for (const word of words) {
    if (!word.word || word.start === undefined || word.end === undefined) continue;

    const scaledStart = word.start / speedFactor;
    const scaledEnd = word.end / speedFactor;
    const wordLength = word.word.length;

    if (!currentChunk) {
      // Start new chunk
      currentChunk = {
        text: [word.word],
        start: scaledStart,
        end: scaledEnd,
      };
    } else {
      const timeSinceLastWord = scaledStart - currentChunk.end;
      const chunkWordCount = currentChunk.text.length;
      const currentTotalLength = currentChunk.text.join(" ").length;

      // Calculate if we should add to current chunk or start new one
      const shouldStartNewChunk =
        timeSinceLastWord > 0.3 || // Long pause
        chunkWordCount >= 3 || // Already have 3 words
        (wordLength > 12 && chunkWordCount >= 1) || // Long word, already have 1+ words
        (currentTotalLength > 20 && chunkWordCount >= 2) || // Combined length too long
        wordLength > 18; // Very long word, put it alone

      if (shouldStartNewChunk) {
        chunks.push({
          text: currentChunk.text.join(" "),
          start: currentChunk.start,
          end: currentChunk.end,
        });
        currentChunk = {
          text: [word.word],
          start: scaledStart,
          end: scaledEnd,
        };
      } else {
        // Add to current chunk
        currentChunk.text.push(word.word);
        currentChunk.end = scaledEnd;
      }
    }
  }

  // Add final chunk
  if (currentChunk) {
    chunks.push({
      text: currentChunk.text.join(" "),
      start: currentChunk.start,
      end: currentChunk.end,
    });
  }

  return chunks;
}

function generateASSContent(chunks: SubtitleChunk[]): string {
  // ASS header with CapCut-style formatting
  let assContent = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,10,10,400,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const chunk of chunks) {
    const startTime = formatASSTime(chunk.start);
    const endTime = formatASSTime(chunk.end);
    const text = chunk.text.toLowerCase(); // CapCut uses lowercase

    assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}\n`;
  }

  return assContent;
}

function formatASSTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centiseconds = Math.floor((seconds % 1) * 100);

  return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

export async function generateSubtitles(
  videoPath: string,
  transcript: SyncPrerecordedResponse,
  speedFactor: number = 1.0
): Promise<string> {
  console.log("Generating subtitles from transcript...");
  if (speedFactor !== 1.0) {
    console.log(`Scaling subtitle timestamps by ${speedFactor.toFixed(2)}x speed factor`);
  }

  // Convert transcript to subtitle segments
  const segments = transcriptToSubtitles(transcript, speedFactor);
  console.log(`Generated ${segments.length} subtitle segments`);

  if (segments.length === 0) {
    console.log("No subtitle segments found, returning original video");
    return videoPath;
  }

  // Generate ASS content
  const assContent = generateASSContent(segments);

  // Write ASS file to temp location
  const parsedPath = path.parse(videoPath);
  const assPath = path.join(parsedPath.dir, `${parsedPath.name}.ass`);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_subtitled${parsedPath.ext}`
  );

  // Write ASS file
  const { writeFileSync } = await import("fs");
  writeFileSync(assPath, assContent, "utf-8");
  console.log(`ASS file written to: ${assPath}`);

  // Burn subtitles into video using ffmpeg with ASS filter
  const assPathEscaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -vf "ass=${assPathEscaped}" -c:a copy -y "${outputPath}"`;

  console.log("Burning subtitles into video...");

  try {
    execSync(ffmpegCmd, { stdio: "pipe" });
    console.log(`✅ Subtitles burned successfully: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error(error.stderr?.toString());
    throw new Error(`FFmpeg subtitle burn failed: ${error.stderr?.toString()}`);
  }
}
