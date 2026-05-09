# Music Taste Embedding Map

React + Python MVP for building a music taste map from song text, YouTube links, and user-written reviews.

The seed dataset gives the map an initial shape, but the product goal is user-driven: paste a YouTube or YouTube Music link, fetch basic video metadata, write your own genre/tags/description/review, and add that song to the current taste map. New songs are included in search, similar-song lookup, and taste profile recommendations.

Static demo uses lightweight browser similarity. Real embeddings require local/backend mode.

## What YouTube Import Does

- Uses YouTube oEmbed.
- Fetches basic public video metadata:
  - `title`
  - `author_name`
  - `thumbnail_url`
- Does not fetch comments.
- Does not download audio.
- Does not require `YOUTUBE_API_KEY`.

For real comment import, YouTube Data API v3 would be required. That is intentionally out of scope for this simpler MVP.

## MVP Meaning

### Static deployed version

The static deployed version is designed to work on Vercel or GitHub Pages without Google Cloud setup.

It includes:

- YouTube oEmbed metadata import
- user-written genre, tags, description, and review
- seed songs as initial map anchors
- lightweight browser TF-IDF cosine similarity
- temporary coordinates near the most similar existing song
- search based on description/review/tags/title/artist similarity
- similar song lookup based on text similarity
- taste profile recommendations from selected songs

It does not include:

- YouTube comments
- YouTube Data API
- Google Cloud API keys
- audio extraction
- real sentence-transformers embeddings
- real UMAP recomputation

### Real backend version

The real version uses the Python backend to compute `sentence-transformers` embeddings and recompute UMAP coordinates. That mode is better for serious recommendation quality, but it requires running a backend server locally or deploying a Python backend separately.

## Project Structure

```text
music-embedding-umap/
  backend/
    app.py
    requirements.txt
    data/
      sample_songs.json
  frontend/
    api/
      youtube-oembed.ts
    public/
      sample_songs_umap.json
    src/
      App.tsx
      main.tsx
      styles.css
    package.json
    vite.config.ts
  README.md
```

## Vercel Deployment

Use Vercel for the easiest deployed version.

Vercel settings:

```text
Root Directory: frontend
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

No environment variables are required for the oEmbed MVP.

The Vercel serverless route is:

```text
frontend/api/youtube-oembed.ts
```

It proxies YouTube oEmbed so the browser can fetch title, channel, and thumbnail metadata without a Google API key.

## GitHub Pages

GitHub Pages can host the static React frontend, but it cannot run Vercel API routes. The app still works with seed data and browser-side similarity. It may attempt direct oEmbed fetching in the browser; if the browser blocks that request, the user can still manually fill the song fields after pasting a YouTube link.

## Local Frontend

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Optional Local Backend

The Python backend is still included for local experimentation with real sentence-transformers embeddings and UMAP.

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8787
```

Backend URL:

```text
http://127.0.0.1:8787
```

## MVP Features

- YouTube link metadata fetch via oEmbed
- Manual genre/tags/description/review entry
- Thumbnail display in song details and result cards
- Seed songs as initial map anchors
- Browser-side TF-IDF cosine similarity
- New songs placed near similar existing songs
- Similarity search over title, artist, genre, tags, description, and review
- Similar song lookup from the selected song
- Taste profile recommendations from checked songs
- Optional local backend for real embeddings/UMAP
