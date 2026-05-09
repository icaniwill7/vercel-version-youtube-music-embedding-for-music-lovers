type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function extractVideoId(input: string) {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) {
    return raw;
  }

  const url = new URL(raw);
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return url.pathname.replace("/", "");
  }

  const queryId = url.searchParams.get("v");
  if (queryId) {
    return queryId;
  }

  const pathMatch = url.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/);
  if (pathMatch) {
    return pathMatch[1];
  }

  throw new Error("Could not extract a YouTube video id.");
}

async function youtubeGet(path: string, params: Record<string, string | number>) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing YOUTUBE_API_KEY on Vercel.");
  }

  const url = new URL(`${YOUTUBE_API_BASE}/${path}`);
  Object.entries({ ...params, key: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "YouTube API request failed.");
  }
  return data;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.status(204).json({});
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Use POST." });
    return;
  }

  try {
    const body = typeof request.body === "object" && request.body ? (request.body as Record<string, unknown>) : {};
    const youtubeUrl = String(body.youtube_url || "");
    const maxComments = Math.min(Math.max(Number(body.max_comments || 20), 0), 50);
    const videoId = extractVideoId(youtubeUrl);

    const videos = await youtubeGet("videos", {
      part: "snippet",
      id: videoId,
      maxResults: 1
    });
    const snippet = videos.items?.[0]?.snippet;
    if (!snippet) {
      response.status(404).json({ error: "Video not found." });
      return;
    }

    const comments: string[] = [];
    if (maxComments > 0) {
      const commentData = await youtubeGet("commentThreads", {
        part: "snippet",
        videoId,
        order: "relevance",
        textFormat: "plainText",
        maxResults: maxComments
      });

      for (const item of commentData.items || []) {
        const text = item.snippet?.topLevelComment?.snippet?.textDisplay;
        if (text) {
          comments.push(String(text).replace(/\s+/g, " ").trim());
        }
      }
    }

    response.status(200).json({
      song: {
        id: `yt-${videoId}`,
        title: snippet.title || `YouTube video ${videoId}`,
        artist: snippet.channelTitle || "YouTube",
        genre: "YouTube",
        tags: ["youtube", "comments", "imported", ...(snippet.tags || []).slice(0, 8)],
        review: comments.slice(0, 8).join(" ") || "No public top comments were imported.",
        description: `${String(snippet.description || "").slice(0, 1200)} Imported from YouTube metadata and top comments.`.trim(),
        youtube_url: youtubeUrl,
        youtube_video_id: videoId,
        youtube_comments: comments,
        x: Math.cos(videoId.charCodeAt(0)) * 2,
        y: Math.sin(videoId.charCodeAt(videoId.length - 1)) * 2
      }
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Import failed." });
  }
}
