import { createClient, type DeepgramClient } from "@deepgram/sdk";
import { Resource } from "sst";

let _deepgramClient: DeepgramClient | null = null;

export function getDeepgramClient(): DeepgramClient {
  if (!_deepgramClient) {
    _deepgramClient = createClient(Resource.DeepgramAccessToken.value);
  }
  return _deepgramClient;
}
