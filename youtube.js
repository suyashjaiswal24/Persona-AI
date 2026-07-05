// youtube.js
// -----------------------------------------------------------------------------
// YouTube Data API v3 tools. Each persona's channel is exposed as a tool the
// model can call via TOOL_REQUEST.
//
// Requires a free API key from https://console.cloud.google.com/
//   1. Create a project -> Enable "YouTube Data API v3"
//   2. Create an API key -> put it in .env as YOUTUBE_API_KEY
// -----------------------------------------------------------------------------

import axios from "axios";

const API_BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || key === "REPLACE_WITH_YOUTUBE_API_KEY") {
    throw new Error(
      "YOUTUBE_API_KEY is not set. Add it to your .env file (see .env.example)."
    );
  }
  return key;
}

// Search a specific channel for videos matching a query.
// Returns a compact list of { title, videoId, url, publishedAt }.
export async function searchChannel(channelId, query, maxResults = 5) {
  if (!channelId || channelId.startsWith("REPLACE_WITH")) {
    throw new Error(
      `This persona's youtubeChannelId is not configured yet (got: ${channelId}).`
    );
  }

  const params = {
    key: getApiKey(),
    channelId,
    part: "snippet",
    type: "video",
    order: query && query.toLowerCase() !== "latest" ? "relevance" : "date",
    maxResults,
  };
  if (query && query.toLowerCase() !== "latest") {
    params.q = query;
  }

  const { data } = await axios.get(`${API_BASE}/search`, { params });

  const videos = (data.items || []).map((item) => ({
    title: item.snippet.title,
    videoId: item.id.videoId,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    thumbnail:
      item.snippet.thumbnails?.medium?.url ||
      item.snippet.thumbnails?.default?.url ||
      "",
    publishedAt: item.snippet.publishedAt,
    description: item.snippet.description,
  }));

  return videos;
}

// Convenience wrapper: recent / filtered videos from the channel.
export async function getChannelVideos(channelId, query = "latest") {
  return searchChannel(channelId, query, 5);
}

// Dispatch a tool call by name for a given persona.
export async function runYoutubeTool(functionName, input, persona) {
  const channelId = persona.youtubeChannelId;
  switch (functionName) {
    case "getChannelVideos": {
      const videos = await getChannelVideos(channelId, input || "latest");
      return { channel: persona.name, query: input || "latest", videos };
    }
    case "searchChannel": {
      const videos = await searchChannel(channelId, input || "latest");
      return { channel: persona.name, query: input, videos };
    }
    default:
      throw new Error(`Unknown tool: ${functionName}`);
  }
}
