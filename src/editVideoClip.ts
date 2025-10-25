import { getTranscript } from "./getTranscript";
import { removeDeadspace } from "./removeDeadspace";

export async function editVideoClip(videoPath: string): Promise<string> {
  // Get transcript for this video
  // const transcript = await getTranscript(videoPath);
  // console.log(`VIDEO TRANSCRIPT 🔥\n${JSON.stringify(transcript, null, 2)}`);

  // Remove deadspace from video
  const editedVideoPath = await removeDeadspace(videoPath);

  return editedVideoPath;
}
