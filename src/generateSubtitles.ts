import path from "path";
import ffmpeg from "ffmpeg-static";
import { execSync } from "child_process";
import type { SyncPrerecordedResponse } from "@deepgram/sdk";

interface SubtitleSegment {
  text: string;
  start: number;
  end: number;
}

function transcriptToSubtitles(
  transcript: SyncPrerecordedResponse
): SubtitleSegment[] {
  const segments: SubtitleSegment[] = [];

  // Extract word-level timing from Deepgram transcript
  const words = transcript.results?.channels[0]?.alternatives[0]?.words || [];

  for (const word of words) {
    if (word.word && word.start !== undefined && word.end !== undefined) {
      segments.push({
        text: word.word,
        start: word.start,
        end: word.end,
      });
    }
  }

  return segments;
}

function generateSRTContent(segments: SubtitleSegment[]): string {
  let srtContent = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const index = i + 1;

    // Convert seconds to SRT time format (HH:MM:SS,mmm)
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);

    srtContent += `${index}\n`;
    srtContent += `${startTime} --> ${endTime}\n`;
    srtContent += `${segment.text}\n\n`;
  }

  return srtContent;
}

function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
}

export async function generateSubtitles(
  videoPath: string,
  transcript: SyncPrerecordedResponse
): Promise<string> {
  console.log("Generating subtitles from transcript...");

  // Convert transcript to subtitle segments
  const segments = transcriptToSubtitles(transcript);
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
  const { writeFileSync } = await import("fs");
  writeFileSync(srtPath, srtContent, "utf-8");
  console.log(`SRT file written to: ${srtPath}`);

  // Burn subtitles into video using ffmpeg
  // Using subtitles filter with styling for social media look
  const subtitleFilter = `subtitles=${srtPath.replace(/\\/g, "/")}:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=2,Shadow=1,MarginV=50'`;

  const ffmpegCmd = `"${ffmpeg}" -i "${videoPath}" -vf "${subtitleFilter}" -c:a copy -y "${outputPath}"`;

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
