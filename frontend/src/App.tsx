import { MouseEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Map, Music2, Search, Sparkles } from "lucide-react";

const API_BASE = "http://127.0.0.1:8787";
const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const isGitHubPages = window.location.hostname.endsWith("github.io");
const isStaticPage = !isLocalHost;
const hasServerlessApi = !isLocalHost && !isGitHubPages;

type Song = {
  id: string;
  title: string;
  artist: string;
  genre: string;
  tags: string[];
  review: string;
  description: string;
  youtube_url?: string;
  youtube_video_id?: string;
  thumbnail_url?: string;
  x: number | null;
  y: number | null;
  similarity?: number;
};

type DraftSong = {
  youtube_url: string;
  title: string;
  artist: string;
  thumbnail_url: string;
  genre: string;
  tags: string;
  description: string;
  review: string;
};

type Point = Song & {
  sx: number;
  sy: number;
};

const emptyDraft: DraftSong = {
  youtube_url: "",
  title: "",
  artist: "",
  thumbnail_url: "",
  genre: "YouTube",
  tags: "youtube, user review",
  description: "",
  review: ""
};

const palette = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#65a30d",
  "#c026d3",
  "#0f766e",
  "#b45309"
];

function colorForGenre(genre: string, genres: string[]) {
  const index = Math.max(0, genres.indexOf(genre));
  return palette[index % palette.length];
}

function formatScore(score?: number) {
  return typeof score === "number" ? `${(score * 100).toFixed(1)}%` : "";
}

async function readBackend<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function readStaticSongs(): Promise<Song[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}sample_songs_umap.json`);
  const data = await response.json();
  return data.songs;
}

async function fetchOembed(youtubeUrl: string) {
  const path = "/api/youtube-oembed";
  if (hasServerlessApi) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ youtube_url: youtubeUrl })
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data as { title: string; author_name: string; thumbnail_url: string; youtube_url: string };
  }

  const oembedUrl = new URL("https://www.youtube.com/oembed");
  oembedUrl.searchParams.set("url", youtubeUrl);
  oembedUrl.searchParams.set("format", "json");
  const response = await fetch(oembedUrl);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "YouTube oEmbed request failed.");
  }
  return data as { title: string; author_name: string; thumbnail_url: string };
}

function songText(song: Song) {
  return [song.title, song.artist, song.genre, song.tags.join(" "), song.description, song.review]
    .join(" ")
    .toLowerCase();
}

function tokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9가-힣]+/i)
    .filter((token) => token.length > 1);
}

function termCounts(text: string) {
  const counts = new Map<string, number>();
  for (const token of tokens(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function tfidfCosine(queryText: string, song: Song, corpus: Song[]) {
  const queryCounts = termCounts(queryText);
  const songCounts = termCounts(songText(song));
  const terms = new Set([...queryCounts.keys(), ...songCounts.keys()]);
  if (!terms.size) {
    return 0;
  }

  let dot = 0;
  let queryNorm = 0;
  let songNorm = 0;
  const corpusSize = Math.max(1, corpus.length);

  for (const term of terms) {
    const docFrequency = corpus.filter((item) => tokens(songText(item)).includes(term)).length;
    const idf = Math.log((1 + corpusSize) / (1 + docFrequency)) + 1;
    const queryWeight = (queryCounts.get(term) ?? 0) * idf;
    const songWeight = (songCounts.get(term) ?? 0) * idf;
    dot += queryWeight * songWeight;
    queryNorm += queryWeight * queryWeight;
    songNorm += songWeight * songWeight;
  }

  if (!queryNorm || !songNorm) {
    return 0;
  }
  return dot / (Math.sqrt(queryNorm) * Math.sqrt(songNorm));
}

function localRank(queryText: string, candidates: Song[], topK = 5, excludeId?: string, corpus = candidates) {
  return candidates
    .filter((song) => song.id !== excludeId)
    .map((song) => ({ ...song, similarity: Math.min(0.99, tfidfCosine(queryText, song, corpus)) }))
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, topK);
}

function hashNumber(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function coordinatesForDraft(draft: DraftSong, songs: Song[]) {
  const text = [draft.title, draft.artist, draft.genre, draft.tags, draft.description, draft.review].join(" ");
  const nearest = localRank(text, songs, 1, undefined, songs)[0];
  const hash = hashNumber(`${draft.youtube_url}${draft.title}`);
  const jitterX = ((hash % 17) - 8) / 20;
  const jitterY = (((hash >> 4) % 17) - 8) / 20;
  if (nearest && typeof nearest.x === "number" && typeof nearest.y === "number") {
    return { x: nearest.x + jitterX, y: nearest.y + jitterY };
  }
  return {
    x: Math.cos(hash) * 2,
    y: Math.sin(hash) * 2
  };
}

function extractVideoId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.replace("/", "");
    }
    return parsed.searchParams.get("v") || undefined;
  } catch {
    return undefined;
  }
}

export default function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [hoveredSong, setHoveredSong] = useState<Song | null>(null);
  const [query, setQuery] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [draftSong, setDraftSong] = useState<DraftSong | null>(null);
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [similarSongs, setSimilarSongs] = useState<Song[]>([]);
  const [profileResults, setProfileResults] = useState<Song[]>([]);
  const [likedSongIds, setLikedSongIds] = useState<string[]>([]);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(isStaticPage);

  useEffect(() => {
    loadSongs();
  }, []);

  const genres = useMemo(
    () => Array.from(new Set(songs.map((song) => song.genre))).sort(),
    [songs]
  );

  const highlightedIds = useMemo(
    () => new Set(searchResults.map((song) => song.id)),
    [searchResults]
  );

  const points = useMemo<Point[]>(() => {
    const drawable = songs.filter(
      (song): song is Song & { x: number; y: number } =>
        typeof song.x === "number" && typeof song.y === "number"
    );
    if (!drawable.length) {
      return [];
    }

    const xs = drawable.map((song) => song.x);
    const ys = drawable.map((song) => song.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = 760;
    const height = 520;
    const pad = 48;

    return drawable.map((song) => {
      const xRatio = maxX === minX ? 0.5 : (song.x - minX) / (maxX - minX);
      const yRatio = maxY === minY ? 0.5 : (song.y - minY) / (maxY - minY);
      return {
        ...song,
        sx: pad + xRatio * (width - pad * 2),
        sy: height - pad - yRatio * (height - pad * 2)
      };
    });
  }, [songs]);

  async function loadSongs() {
    try {
      setError("");
      if (isStaticPage) {
        const staticSongs = await readStaticSongs();
        setSongs(staticSongs);
        setSelectedSong(staticSongs[0] ?? null);
        return;
      }
      const data = await readBackend<{ songs: Song[] }>("/api/songs");
      setSongs(data.songs);
      setSelectedSong((current) => current ?? data.songs[0] ?? null);
    } catch {
      const staticSongs = await readStaticSongs();
      setDemoMode(true);
      setSongs(staticSongs);
      setSelectedSong(staticSongs[0] ?? null);
      setError("Local backend is not running, so static demo data is loaded.");
    }
  }

  async function buildIndex() {
    try {
      setLoading("build");
      setError("");
      setSearchResults([]);
      setSimilarSongs([]);
      setProfileResults([]);
      if (demoMode) {
        const staticSongs = await readStaticSongs();
        setSongs(staticSongs);
        setSelectedSong(staticSongs[0] ?? null);
        return;
      }
      const data = await readBackend<{ songs: Song[] }>("/api/build-index", { method: "POST" });
      setSongs(data.songs);
      setSelectedSong(data.songs[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build index.");
    } finally {
      setLoading("");
    }
  }

  async function importYoutube() {
    if (!youtubeUrl.trim()) {
      return;
    }
    try {
      setLoading("youtube");
      setError("");
      const metadata = await fetchOembed(youtubeUrl);
      setDraftSong({
        ...emptyDraft,
        youtube_url: youtubeUrl,
        title: metadata.title || "",
        artist: metadata.author_name || "",
        thumbnail_url: metadata.thumbnail_url || ""
      });
    } catch (err) {
      setDraftSong({ ...emptyDraft, youtube_url: youtubeUrl });
      setError(
        err instanceof Error
          ? `${err.message}. You can still fill the song fields manually.`
          : "Could not fetch YouTube metadata. You can still fill the song fields manually."
      );
    } finally {
      setLoading("");
    }
  }

  function saveDraftSong() {
    if (!draftSong || !draftSong.title.trim()) {
      setError("Add at least a title before saving the song.");
      return;
    }

    const coords = coordinatesForDraft(draftSong, songs);
    const newSong: Song = {
      id: `user-${Date.now()}`,
      title: draftSong.title.trim(),
      artist: draftSong.artist.trim() || "Unknown artist",
      genre: draftSong.genre.trim() || "User Added",
      tags: draftSong.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      description: draftSong.description.trim(),
      review: draftSong.review.trim(),
      youtube_url: draftSong.youtube_url,
      youtube_video_id: extractVideoId(draftSong.youtube_url),
      thumbnail_url: draftSong.thumbnail_url,
      x: coords.x,
      y: coords.y
    };

    setSongs((current) => [...current, newSong]);
    setSelectedSong(newSong);
    setDraftSong(null);
    setYoutubeUrl("");
    setError("");
  }

  async function searchSongs() {
    if (!query.trim()) {
      return;
    }
    try {
      setLoading("search");
      setError("");
      if (demoMode) {
        setSearchResults(localRank(query, songs, 5, undefined, songs));
        return;
      }
      const data = await readBackend<{ results: Song[] }>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, top_k: 5 })
      });
      setSearchResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setLoading("");
    }
  }

  async function findSimilar(songId: string) {
    try {
      setLoading("similar");
      setError("");
      if (demoMode) {
        const selected = songs.find((song) => song.id === songId);
        if (selected) {
          setSimilarSongs(localRank(songText(selected), songs, 5, songId, songs));
        }
        return;
      }
      const data = await readBackend<{ results: Song[] }>(`/api/similar/${songId}`);
      setSimilarSongs(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find similar songs.");
    } finally {
      setLoading("");
    }
  }

  async function buildUserProfile() {
    if (!likedSongIds.length) {
      setError("Choose at least one liked song.");
      return;
    }
    try {
      setLoading("profile");
      setError("");
      if (demoMode) {
        const likedSongs = songs.filter((song) => likedSongIds.includes(song.id));
        const profileText = likedSongs.map(songText).join(" ");
        setProfileResults(
          localRank(profileText, songs.filter((song) => !likedSongIds.includes(song.id)), 5, undefined, songs)
        );
        return;
      }
      const data = await readBackend<{ results: Song[] }>("/api/user-profile", {
        method: "POST",
        body: JSON.stringify({ liked_song_ids: likedSongIds, top_k: 5 })
      });
      setProfileResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Taste recommendation failed.");
    } finally {
      setLoading("");
    }
  }

  function toggleLiked(songId: string) {
    setLikedSongIds((current) => {
      if (current.includes(songId)) {
        return current.filter((id) => id !== songId);
      }
      if (current.length >= 5) {
        return current;
      }
      return [...current, songId];
    });
  }

  function selectPoint(song: Song, event?: MouseEvent<SVGCircleElement>) {
    event?.stopPropagation();
    setSelectedSong(song);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            <Map size={16} />
            YouTube Link + User Review Map
          </div>
          <h1>Music Taste Embedding Map</h1>
          <p>Add a YouTube link, write your own genre/tags/review, and place it on a 2D taste map.</p>
          <p className="demo-note">Static demo uses lightweight browser similarity. Real embeddings require local/backend mode.</p>
          {demoMode && (
            <p className="demo-note">
              This demo uses YouTube oEmbed for basic metadata only. Comments are not fetched.
            </p>
          )}
        </div>
        <button className="primary-button" onClick={buildIndex} disabled={loading === "build"}>
          {loading === "build" ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
          {demoMode ? "Reset Demo" : "Build Index"}
        </button>
      </header>

      {error && <div className="error-card">{error}</div>}

      <section className="layout">
        <div className="map-column">
          <div className="toolbar-card stacked-tools">
            <div className="search-row">
              <Search size={18} />
              <input
                value={query}
                placeholder="Example: dreamy K-pop for late-night listening"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") searchSongs();
                }}
              />
              <button onClick={searchSongs} disabled={loading === "search"}>
                {loading === "search" ? "Searching" : "Search"}
              </button>
            </div>
            <div className="search-row">
              <Music2 size={18} />
              <input
                value={youtubeUrl}
                placeholder="Paste a YouTube or YouTube Music link"
                onChange={(event) => setYoutubeUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") importYoutube();
                }}
              />
              <button onClick={importYoutube} disabled={loading === "youtube"}>
                {loading === "youtube" ? "Fetching" : "Fetch Info"}
              </button>
            </div>
          </div>

          {draftSong && (
            <DraftSongForm
              draft={draftSong}
              onChange={setDraftSong}
              onCancel={() => setDraftSong(null)}
              onSave={saveDraftSong}
            />
          )}

          <div className="map-card">
            <div className="map-header">
              <div>
                <h2>UMAP Scatter Plot</h2>
                <span>{points.length ? `${points.length} songs on the map. Seed songs are only a starting point.` : "Add or reset songs to create coordinates"}</span>
              </div>
              <div className="legend">
                {genres.map((genre) => (
                  <span key={genre}>
                    <i style={{ backgroundColor: colorForGenre(genre, genres) }} />
                    {genre}
                  </span>
                ))}
              </div>
            </div>

            <div className="svg-wrap">
              <svg viewBox="0 0 760 520" role="img" aria-label="Music embedding scatter plot">
                <rect x="0" y="0" width="760" height="520" rx="8" />
                {points.map((point) => {
                  const isSelected = selectedSong?.id === point.id;
                  const isHighlighted = highlightedIds.has(point.id);
                  return (
                    <circle
                      key={point.id}
                      cx={point.sx}
                      cy={point.sy}
                      r={isSelected ? 9 : isHighlighted ? 8 : 6}
                      fill={colorForGenre(point.genre, genres)}
                      stroke={isSelected ? "#111827" : isHighlighted ? "#facc15" : "#ffffff"}
                      strokeWidth={isSelected || isHighlighted ? 4 : 2}
                      onClick={(event) => selectPoint(point, event)}
                      onMouseEnter={() => setHoveredSong(point)}
                      onMouseLeave={() => setHoveredSong(null)}
                    />
                  );
                })}
                {!points.length && (
                  <text x="380" y="260" textAnchor="middle">
                    Add a YouTube song to display the map.
                  </text>
                )}
              </svg>
              {hoveredSong && (
                <div className="tooltip">
                  <strong>{hoveredSong.title}</strong>
                  <span>{hoveredSong.artist}</span>
                </div>
              )}
            </div>
          </div>

          <div className="profile-card">
            <div className="section-title">
              <Music2 size={18} />
              <h2>Taste Profile Test</h2>
            </div>
            <div className="check-grid">
              {songs.map((song) => (
                <label key={song.id} className={likedSongIds.includes(song.id) ? "checked" : ""}>
                  <input
                    type="checkbox"
                    checked={likedSongIds.includes(song.id)}
                    onChange={() => toggleLiked(song.id)}
                  />
                  <span>{song.title}</span>
                </label>
              ))}
            </div>
            <button className="secondary-button" onClick={buildUserProfile} disabled={loading === "profile"}>
              {loading === "profile" ? "Recommending" : "Find Songs Near My Taste"}
            </button>
          </div>
        </div>

        <aside className="side-column">
          <DetailPanel song={selectedSong} loading={loading === "similar"} onSimilar={findSimilar} />
          <ResultList title="Search Results" songs={searchResults} empty="Search results will appear here." onPick={setSelectedSong} />
          <ResultList title="Similar Songs" songs={similarSongs} empty="Pick a song, then find similar tracks." onPick={setSelectedSong} />
          <ResultList title="Taste Recommendations" songs={profileResults} empty="Choose liked songs to get recommendations." onPick={setSelectedSong} />
        </aside>
      </section>
    </main>
  );
}

function DraftSongForm({
  draft,
  onChange,
  onCancel,
  onSave
}: {
  draft: DraftSong;
  onChange: (draft: DraftSong) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const update = (field: keyof DraftSong, value: string) => onChange({ ...draft, [field]: value });

  return (
    <section className="toolbar-card draft-card">
      {draft.thumbnail_url && <img className="draft-thumb" src={draft.thumbnail_url} alt="" />}
      <div className="draft-fields">
        <label>
          <span>Title</span>
          <input value={draft.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <label>
          <span>Artist / Channel</span>
          <input value={draft.artist} onChange={(event) => update("artist", event.target.value)} />
        </label>
        <label>
          <span>Genre</span>
          <input value={draft.genre} onChange={(event) => update("genre", event.target.value)} />
        </label>
        <label>
          <span>Tags</span>
          <input value={draft.tags} onChange={(event) => update("tags", event.target.value)} placeholder="dreamy, band, night" />
        </label>
        <label>
          <span>Description</span>
          <textarea value={draft.description} onChange={(event) => update("description", event.target.value)} />
        </label>
        <label>
          <span>Review / Comment Summary</span>
          <textarea value={draft.review} onChange={(event) => update("review", event.target.value)} />
        </label>
      </div>
      <div className="draft-actions">
        <button className="secondary-button" onClick={onSave}>Save/Add Song</button>
        <button className="ghost-button" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function DetailPanel({
  song,
  loading,
  onSimilar
}: {
  song: Song | null;
  loading: boolean;
  onSimilar: (songId: string) => void;
}) {
  if (!song) {
    return (
      <section className="card detail-panel">
        <h2>Details</h2>
        <p className="muted">Select a point on the map.</p>
      </section>
    );
  }

  return (
    <section className="card detail-panel">
      {song.thumbnail_url && <img className="detail-thumb" src={song.thumbnail_url} alt="" />}
      <div className="detail-heading">
        <div>
          <h2>{song.title}</h2>
          <p>{song.artist}</p>
        </div>
        <span>{song.genre}</span>
      </div>
      <div className="tag-row">
        {song.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      {song.youtube_url && (
        <a className="youtube-link" href={song.youtube_url} target="_blank" rel="noreferrer">
          Open YouTube source
        </a>
      )}
      <h3>Description</h3>
      <p>{song.description || "No description yet."}</p>
      <h3>Review / Comment Summary</h3>
      <p>{song.review || "No review yet."}</p>
      <button className="secondary-button" onClick={() => onSimilar(song.id)} disabled={loading}>
        {loading ? "Finding" : "Find Similar Songs"}
      </button>
    </section>
  );
}

function ResultList({
  title,
  songs,
  empty,
  onPick
}: {
  title: string;
  songs: Song[];
  empty: string;
  onPick: (song: Song) => void;
}) {
  return (
    <section className="card result-list">
      <h2>{title}</h2>
      {!songs.length && <p className="muted">{empty}</p>}
      {songs.map((song) => (
        <button key={song.id} className="result-item" onClick={() => onPick(song)}>
          {song.thumbnail_url && <img src={song.thumbnail_url} alt="" />}
          <strong>{song.title}</strong>
          <span>
            {song.artist} - {song.genre}
          </span>
          {typeof song.similarity === "number" && <em>{formatScore(song.similarity)}</em>}
        </button>
      ))}
    </section>
  );
}
