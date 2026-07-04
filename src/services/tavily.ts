import { config } from "../config.js";
import { logger } from "../logger.js";
import type { ResearchSource } from "../types.js";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  published_date?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function searchWeb(query: string, maxResults = 6): Promise<ResearchSource[]> {
  if (!config.TAVILY_API_KEY) {
    return [];
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      api_key: config.TAVILY_API_KEY,
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: true,
      include_images: false
    })
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn({ status: response.status, text }, "Tavily search failed");
    return [];
  }

  const payload = (await response.json()) as TavilyResponse;
  return (payload.results ?? [])
    .filter((result): result is Required<Pick<TavilyResult, "title" | "url">> & TavilyResult => {
      return Boolean(result.title && result.url);
    })
    .slice(0, maxResults)
    .map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content ?? result.raw_content?.slice(0, 500),
      publishedDate: result.published_date,
      sourceType: "web"
    }));
}
