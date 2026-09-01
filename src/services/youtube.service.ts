import axios from "axios";
import { env } from "../config/env.ts";

export function extractYoutubeId(url: string) {
  try {
    const raw = url.trim();
    if (!raw) return "";
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : "";
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{6,}$/.test(v)) return v;
      const fromPath = u.pathname.match(/\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{6,})/);
      if (fromPath?.[1]) return fromPath[1];
    }
    return "";
  } catch {
    return "";
  }
}

export async function youtubeVideoMeta(videoId: string) {
  if (!env.YOUTUBE_API_KEY || !videoId) return null;
  const { data } = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
    params: { id: videoId, part: "snippet,liveStreamingDetails", key: env.YOUTUBE_API_KEY },
    timeout: 8000,
  });
  return data?.items?.[0] ?? null;
}
