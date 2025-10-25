import { getTranscript } from "./getTranscript";
import { removeDeadspace } from "./removeDeadspace";
import { generateSubtitles } from "./generateSubtitles";

export async function editVideoClip(videoPath: string): Promise<string> {
  // Remove deadspace from video
  const deadspaceRemovedPath = await removeDeadspace(videoPath);

  // Get transcript for the cleaned video
  const transcript = await getTranscript(deadspaceRemovedPath);
  console.log(`VIDEO TRANSCRIPT 🔥\n${JSON.stringify(transcript, null, 2)}`);

  // Generate and burn in subtitles
  const finalVideoPath = await generateSubtitles(deadspaceRemovedPath, transcript);

  return finalVideoPath;
}
