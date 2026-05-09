type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

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
    const youtubeUrl = String(body.youtube_url || "").trim();
    if (!youtubeUrl) {
      response.status(400).json({ error: "youtube_url is required." });
      return;
    }

    const oembedUrl = new URL("https://www.youtube.com/oembed");
    oembedUrl.searchParams.set("url", youtubeUrl);
    oembedUrl.searchParams.set("format", "json");

    const oembedResponse = await fetch(oembedUrl);
    const data = await oembedResponse.json();
    if (!oembedResponse.ok) {
      response.status(oembedResponse.status).json({ error: data.error || "YouTube oEmbed request failed." });
      return;
    }

    response.status(200).json({
      title: data.title || "",
      author_name: data.author_name || "",
      thumbnail_url: data.thumbnail_url || "",
      youtube_url: youtubeUrl
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "YouTube oEmbed import failed." });
  }
}
