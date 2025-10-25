import { getTranscript } from "./getTranscript";

export async function editVideoClip(videoPath: string): Promise<string> {
  // Get transcript for this video
  const transcript = await getTranscript(videoPath);
  console.log(`VIDEO TRANSCRIPT 🔥\n${JSON.stringify(transcript, null, 2)}`);

  // For now, just return the original video path
  // TODO: Remove dead spots based on transcript
  // TODO: Apply other edits
  return videoPath;
}
