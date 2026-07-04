import { config } from "../config.js";
import { logger } from "../logger.js";
import type { DeckAsset } from "../types.js";

interface OpenverseImage {
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_url?: string;
  source?: string;
}

interface OpenverseResponse {
  results?: OpenverseImage[];
}

export async function searchLicensedImages(query: string, count = 5): Promise<DeckAsset[]> {
  const queries = buildImageQueries(query);
  const seen = new Set<string>();
  const assets: DeckAsset[] = [];

  for (const searchQuery of queries) {
    const batch = await runOpenverseSearch(searchQuery, count);
    for (const asset of batch) {
      if (seen.has(asset.url)) {
        continue;
      }
      seen.add(asset.url);
      assets.push(asset);
      if (assets.length >= count) {
        return assets;
      }
    }
  }

  return assets;
}

function buildImageQueries(query: string): string[] {
  const cleaned = query.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const words = cleaned
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !["slack", "agent", "deck", "presentation", "website"].includes(word.toLowerCase()));
  const shortQuery = words.slice(0, 5).join(" ");

  return [
    cleaned,
    shortQuery,
    `${shortQuery || cleaned} business meeting`,
    "team collaboration",
    "business presentation"
  ].filter((value, index, all) => value && all.indexOf(value) === index);
}

async function runOpenverseSearch(query: string, count = 5): Promise<DeckAsset[]> {
  const url = new URL("/v1/images/", config.OPENVERSE_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("page_size", String(count));
  url.searchParams.set("mature", "false");
  url.searchParams.set("license_type", "commercial,modification");

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Openverse image search failed");
      return [];
    }

    const payload = (await response.json()) as OpenverseResponse;
    return (payload.results ?? [])
      .filter((image): image is Required<Pick<OpenverseImage, "title" | "url">> & OpenverseImage => {
        return Boolean(image.title && image.url);
      })
      .slice(0, count)
      .map((image) => ({
        title: image.title,
        url: image.url,
        thumbnailUrl: image.thumbnail,
        creator: image.creator,
        creatorUrl: image.creator_url,
        license: image.license,
        licenseUrl: image.license_url,
        source: image.source
      }));
  } catch (error) {
    logger.warn({ error }, "Openverse image search crashed");
    return [];
  }
}
