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

function generateSRTContent(chunks: SubtitleChunk[]): string {
  let srtContent = "";

  chunks.forEach((chunk, index) => {
    const startTime = formatSRTTime(chunk.start);
    const endTime = formatSRTTime(chunk.end);
    const text = chunk.text.toUpperCase(); // CapCut-style uppercase

    srtContent += `${index + 1}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${text}\n\n`;
  });

  return srtContent;
}

function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const milliseconds = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${milliseconds.toString().padStart(3, "0")}`;
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

  // Generate SRT content
  const srtContent = generateSRTContent(segments);

  // Write SRT file to temp location
  const parsedPath = path.parse(videoPath);
  const srtPath = path.join(parsedPath.dir, `${parsedPath.name}.srt`);
  const outputPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}_subtitled${parsedPath.ext}`
  );

  // Write SRT file
  const { writeFileSync, statSync } = await import("fs");
  writeFileSync(srtPath, srtContent, "utf-8");
  console.log(`SRT file written to: ${srtPath}`);

  // Verify file was written
  const stats = statSync(srtPath);
  console.log(`SRT file size: ${stats.size} bytes`);
  console.log(`SRT content preview (first 500 chars):\n${srtContent.substring(0, 500)}`);

  // Burn subtitles into video using ffmpeg with subtitles filter
  // Explicitly provide fonts directory so ffmpeg can find fonts in Lambda
  const srtPathEscaped = srtPath.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const fontDir = "/var/task/fonts"; // Where SST copies our fonts
  const subtitlesFilter = `subtitles='${srtPathEscaped}':fontsdir='${fontDir}':force_style='FontName=Liberation Sans,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=50'`;
  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -vf "${subtitlesFilter}" -c:a copy -y "${outputPath}"`;

  console.log("Burning subtitles into video...");
  console.log(`SRT path: ${srtPath}`);
  console.log(`SRT path escaped: ${srtPathEscaped}`);
  console.log(`Video input: ${videoPath}`);
  console.log(`Video output: ${outputPath}`);
  console.log(`FFmpeg command: ${ffmpegCmd}`);

  try {
    const result = execSync(ffmpegCmd, { stdio: "pipe" });
    console.log("FFmpeg stdout:", result.toString());
    console.log(`✅ Subtitles burned successfully: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.error(`FFmpeg failed with exit code ${error.status}`);
    console.error("FFmpeg stdout:", error.stdout?.toString());
    console.error("FFmpeg stderr:", error.stderr?.toString());
    throw new Error(`FFmpeg subtitle burn failed: ${error.stderr?.toString()}`);
  }
}
