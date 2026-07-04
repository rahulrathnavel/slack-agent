import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { config } from "../config.js";
import { renderDeckSite } from "../deck/render.js";
import { logger } from "../logger.js";
import { redactSensitiveText, truncateForPrompt } from "../safety.js";
import { readJsonFile } from "../storage/files.js";
import { searchLicensedImages } from "../services/openverse.js";
import { searchSlackContext } from "../services/slackSearch.js";
import { searchWeb } from "../services/tavily.js";
import { NvidiaClient } from "../services/nvidia.js";
import type {
  DeckAsset,
  DeckPlan,
  DeckRequest,
  GeneratedDeck,
  ResearchSource,
  SlackContextSearchResult,
  SlidePlan
} from "../types.js";

const SlidePlanSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  layout: z.enum(["title", "section", "image", "bullets", "quote", "comparison", "timeline", "closing"]),
  bullets: z.array(z.string()).min(0).max(6),
  visualPrompt: z.string().optional(),
  imageQuery: z.string().optional(),
  speakerNotes: z.string().optional(),
  citationUrls: z.array(z.string()).optional()
});

export const DeckPlanSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().min(1),
  presenters: z.array(z.string()).default([]),
  narrative: z.string().min(1),
  slides: z.array(SlidePlanSchema).min(1).max(20),
  sources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
      sourceType: z.enum(["web", "slack", "asset", "user"]),
      author: z.string().optional(),
      publishedDate: z.string().optional()
    })
  ),
  recommendedFollowups: z.array(z.string()).default([])
});

interface GenerateOptions {
  botToken?: string;
  userToken?: string;
  actionToken?: string;
}

export class DeckAgent {
  constructor(private readonly nvidia = new NvidiaClient()) {}

  async generate(request: DeckRequest, options: GenerateOptions = {}): Promise<GeneratedDeck> {
    const safeRequest = sanitizeRequest(request);
    const topic = safeRequest.title || safeRequest.topic;

    const webPromise: Promise<ResearchSource[]> = safeRequest.useWebResearch ? searchWeb(topic, 7) : Promise.resolve([]);
    const assetPromise: Promise<DeckAsset[]> = safeRequest.useLicensedImages
      ? searchLicensedImages(topic, Math.min(8, safeRequest.slideCount))
      : Promise.resolve([]);
    const slackPromise: Promise<SlackContextSearchResult> = safeRequest.useSlackContext
      ? searchSlackContext({
          query: topic,
          botToken: options.botToken,
          userToken: options.userToken,
          actionToken: options.actionToken,
          contextChannelId: safeRequest.channelId
        })
      : Promise.resolve({ sources: [], text: "" });

    const [webSources, assets, slackContext] = await Promise.all([webPromise, assetPromise, slackPromise]);

    if (slackContext.unavailableReason) {
      logger.info({ reason: slackContext.unavailableReason }, "Slack RTS context unavailable");
    }

    const sources = dedupeSources([
      ...webSources,
      ...slackContext.sources,
      ...parseUserSources(safeRequest.customContext, safeRequest.assetLinks)
    ]);

    const plan = await this.createPlan(safeRequest, sources, assets, slackContext.text);
    const deckId = `${Date.now()}-${nanoid(8)}`;
    const localDir = path.join(config.decksDir, deckId);
    const publicUrl = `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/decks/${deckId}/`;

    await renderDeckSite({
      deckId,
      outputDir: localDir,
      publicUrl,
      plan,
      request: safeRequest,
      assets,
      sources
    });

    return {
      deckId,
      title: plan.title,
      publicUrl,
      localDir,
      plan,
      sources,
      assets
    };
  }

  async revise(deckId: string, instruction: string): Promise<GeneratedDeck> {
    const manifestPath = path.join(config.decksDir, deckId, "deck.json");
    const manifest = await readJsonFile<{
      publicUrl: string;
      plan: DeckPlan;
      request: DeckRequest;
      assets: DeckAsset[];
      sources: ResearchSource[];
    }>(manifestPath);

    if (!manifest) {
      throw new Error(`Deck ${deckId} was not found.`);
    }

    const revisedPlan = await this.revisePlan(manifest.plan, manifest.request, manifest.sources, instruction);
    await renderDeckSite({
      deckId,
      outputDir: path.join(config.decksDir, deckId),
      publicUrl: manifest.publicUrl,
      plan: revisedPlan,
      request: manifest.request,
      assets: manifest.assets,
      sources: manifest.sources
    });

    return {
      deckId,
      title: revisedPlan.title,
      publicUrl: manifest.publicUrl,
      localDir: path.join(config.decksDir, deckId),
      plan: revisedPlan,
      sources: manifest.sources,
      assets: manifest.assets
    };
  }

  private async createPlan(
    request: DeckRequest,
    sources: ResearchSource[],
    assets: DeckAsset[],
    slackContextText: string
  ): Promise<DeckPlan> {
    const sourcePack = sources
      .slice(0, 12)
      .map((source, index) => {
        return `[${index + 1}] ${source.title}\nURL: ${source.url}\nType: ${source.sourceType}\nSnippet: ${
          source.snippet ?? ""
        }`;
      })
      .join("\n\n");

    const assetPack = assets
      .slice(0, 8)
      .map((asset, index) => {
        return `[${index + 1}] ${asset.title}\nURL: ${asset.url}\nLicense: ${asset.license ?? "unknown"}\nCreator: ${
          asset.creator ?? "unknown"
        }`;
      })
      .join("\n\n");

    const messages = [
      {
        role: "system" as const,
        content:
          "You are PioltPPT, a senior business presentation strategist. Create concise, visually specific, organization-ready presentation website plans. Return only strict JSON. Do not use markdown fences."
      },
      {
        role: "user" as const,
        content: `Create a ${request.slideCount}-slide deck plan.

Required JSON shape:
{
  "title": "string",
  "subtitle": "string",
  "presenters": ["string"],
  "narrative": "string",
  "slides": [
    {
      "title": "string",
      "subtitle": "string optional",
      "layout": "title|section|image|bullets|quote|comparison|timeline|closing",
      "bullets": ["short bullet"],
      "visualPrompt": "string optional",
      "imageQuery": "string optional",
      "speakerNotes": "string optional",
      "citationUrls": ["source URL optional"]
    }
  ],
  "sources": [{"title":"string","url":"string","snippet":"string optional","sourceType":"web|slack|asset|user"}],
  "recommendedFollowups": ["string"]
}

Rules:
- Exactly ${request.slideCount} slides.
- Slide 1 must work as the title slide.
- Last slide must be a closing or action slide.
- Make bullets executive-readable: short, concrete, non-generic.
- Use citations only from the source URLs provided below.
- If sources are thin, say so in speaker notes and avoid invented facts.
- If licensed assets are available, include imageQuery values that match them.
- Include speakerNotes ${request.includeSpeakerNotes ? "for every slide" : "only when useful"}.

Request:
Topic: ${request.topic}
Title override: ${request.title ?? ""}
Presenters: ${request.presenters.join(", ") || "Not provided"}
Audience: ${request.audience}
Tone: ${request.tone}
Brand style: ${request.brandStyle}
Include citations: ${request.includeCitations}
Include video links: ${request.includeVideoLinks}
Custom assets/links/files: ${request.assetLinks ?? ""}
Advanced customization prompt: ${request.advancedPrompt ?? ""}

Custom context:
${truncateForPrompt(request.customContext ?? "", 8_000)}

Slack context:
${truncateForPrompt(slackContextText, 8_000)}

Research sources:
${truncateForPrompt(sourcePack || "No research sources available.", 10_000)}

Licensed assets:
${truncateForPrompt(assetPack || "No licensed assets available.", 4_000)}`
      }
    ];

    try {
      const plan = await this.nvidia.chatJson(messages, DeckPlanSchema, {
        model: config.NVIDIA_MODEL_REASONING,
        temperature: 0.25,
        maxTokens: 12_000
      });
      return normalizePlan(plan, request, sources);
    } catch (error) {
      logger.warn({ error }, "Model deck plan failed; using fallback plan");
      return createFallbackPlan(request, sources);
    }
  }

  private async revisePlan(
    plan: DeckPlan,
    request: DeckRequest,
    sources: ResearchSource[],
    instruction: string
  ): Promise<DeckPlan> {
    const messages = [
      {
        role: "system" as const,
        content:
          "You are PioltPPT, a senior presentation editor. Revise the deck plan according to the user's instruction. Keep the JSON shape exactly valid. Return only strict JSON."
      },
      {
        role: "user" as const,
        content: `Revise this presentation website plan.

Instruction:
${truncateForPrompt(instruction, 4_000)}

Rules:
- Preserve the same slide count unless the instruction explicitly asks otherwise.
- Keep citations only from the provided source URLs.
- Preserve speaker notes unless the instruction asks to change them.
- Make the revision specific and useful, not superficial.

Original request:
${JSON.stringify(request, null, 2)}

Available sources:
${truncateForPrompt(JSON.stringify(sources, null, 2), 8_000)}

Current plan:
${truncateForPrompt(JSON.stringify(plan, null, 2), 14_000)}`
      }
    ];

    try {
      const revised = await this.nvidia.chatJson(messages, DeckPlanSchema, {
        model: config.NVIDIA_MODEL_REASONING,
        temperature: 0.2,
        maxTokens: 12_000
      });
      return normalizePlan(revised, request, sources);
    } catch (error) {
      logger.warn({ error }, "Model deck revision failed; preserving original plan");
      return {
        ...plan,
        recommendedFollowups: [
          `Revision failed for instruction: ${redactSensitiveText(instruction).slice(0, 200)}`,
          ...plan.recommendedFollowups
        ]
      };
    }
  }
}

function sanitizeRequest(request: DeckRequest): DeckRequest {
  return {
    ...request,
    topic: redactSensitiveText(request.topic).trim(),
    title: request.title ? redactSensitiveText(request.title).trim() : undefined,
    presenters: request.presenters.map((presenter) => redactSensitiveText(presenter).trim()).filter(Boolean),
    slideCount: Math.max(3, Math.min(12, Math.round(request.slideCount))),
    customContext: request.customContext ? redactSensitiveText(request.customContext) : undefined,
    assetLinks: request.assetLinks ? redactSensitiveText(request.assetLinks) : undefined,
    advancedPrompt: request.advancedPrompt ? redactSensitiveText(request.advancedPrompt) : undefined
  };
}

function normalizePlan(plan: DeckPlan, request: DeckRequest, sources: ResearchSource[]): DeckPlan {
  const slides = [...plan.slides].slice(0, request.slideCount);
  while (slides.length < request.slideCount) {
    slides.push({
      title: slides.length === request.slideCount - 1 ? "Next Steps" : `Key Point ${slides.length + 1}`,
      layout: slides.length === request.slideCount - 1 ? "closing" : "bullets",
      bullets: ["Clarify the decision", "Assign owner and timeline", "Confirm the follow-up channel"],
      speakerNotes: "Generated as a fallback slide to preserve the requested slide count."
    });
  }

  return {
    ...plan,
    title: plan.title || request.title || request.topic,
    presenters: plan.presenters.length ? plan.presenters : request.presenters,
    slides,
    sources: dedupeSources([...plan.sources, ...sources]).slice(0, 20)
  };
}

function createFallbackPlan(request: DeckRequest, sources: ResearchSource[]): DeckPlan {
  const title = request.title || request.topic;
  const topic = request.topic;
  const sourceNote = sources.length
    ? "Use the source list to replace placeholders with verified details."
    : "No verified sources were available, so this slide avoids invented facts.";
  const middleSlides = fallbackSlidesForTopic(topic, sourceNote).slice(0, Math.max(1, request.slideCount - 2));

  return {
    title,
    subtitle: fallbackSubtitle(topic, request),
    presenters: request.presenters,
    narrative: `Give a clear, simple overview of ${topic}.`,
    slides: [
      {
        title,
        subtitle: fallbackSubtitle(topic, request),
        layout: "title" as const,
        bullets: [],
        speakerNotes: "Opening slide. Keep it short and introduce what the deck covers."
      },
      ...middleSlides,
      {
        title: "Next Steps",
        layout: "closing" as const,
        bullets: fallbackClosingBullets(topic),
        speakerNotes: "Close with a practical action list. Add official links or contact details if available."
      }
    ].slice(0, request.slideCount),
    sources,
    recommendedFollowups: [
      "Add official source links for facts that must be verified.",
      "Paste department, placement, facility, or event notes for a richer second pass.",
      "Ask PioltPPT to revise the deck after adding real source material."
    ]
  };
}

function fallbackSlidesForTopic(topic: string, sourceNote: string): SlidePlan[] {
  if (/\b(university|college|campus|school|institute)\b/i.test(topic)) {
    return [
      {
        title: "Campus Snapshot",
        layout: "bullets" as const,
        bullets: [
          "Purpose: give a quick, accurate overview of the campus",
          "Audience: students, parents, visitors, or internal reviewers",
          "Focus: academics, facilities, student life, outcomes, and next steps"
        ],
        visualPrompt: "Simple campus overview panel",
        speakerNotes: sourceNote
      },
      {
        title: "Academic Profile",
        layout: "bullets" as const,
        bullets: [
          "List the major departments and programs from official sources",
          "Highlight labs, projects, research exposure, and academic support",
          "Connect programs to skills, internships, higher studies, or careers"
        ],
        visualPrompt: "Academic departments and learning pathways",
        speakerNotes: sourceNote
      },
      {
        title: "Facilities And Student Life",
        layout: "bullets" as const,
        bullets: [
          "Summarize classrooms, labs, library, hostels, sports, and transport",
          "Add student clubs, events, technical activities, and campus culture",
          "Call out the details visitors usually ask about first"
        ],
        visualPrompt: "Campus facilities and student activity map",
        speakerNotes: sourceNote
      },
      {
        title: "Placements And Outcomes",
        layout: "bullets" as const,
        bullets: [
          "Add verified placement process, training support, and recruiter details",
          "Mention internships, alumni paths, entrepreneurship, or higher-study support",
          "Avoid ranking or salary claims unless the source is official"
        ],
        visualPrompt: "Student outcomes and placement pathway",
        speakerNotes: sourceNote
      },
      {
        title: "Visitor Questions",
        layout: "bullets" as const,
        bullets: [
          "What programs are available here?",
          "What facilities and support are available to students?",
          "What official contact or admission steps should visitors follow?"
        ],
        visualPrompt: "Clean Q&A checklist",
        speakerNotes: sourceNote
      }
    ];
  }

  return [
    {
      title: "Overview",
      layout: "bullets" as const,
      bullets: [
        `Explain what ${topic} is and why it matters`,
        "Define the audience, objective, and expected outcome",
        "Separate verified facts from assumptions or open questions"
      ],
      visualPrompt: "Simple overview panel",
      speakerNotes: sourceNote
    },
    {
      title: "Key Points",
      layout: "bullets" as const,
      bullets: [
        "Summarize the most important facts in plain language",
        "Group details into 3-4 clear themes",
        "Keep each slide focused on one message"
      ],
      visualPrompt: "Three-part summary layout",
      speakerNotes: sourceNote
    },
    {
      title: "What To Know",
      layout: "bullets" as const,
      bullets: [
        "Add relevant facts, examples, constraints, or comparisons",
        "Call out what is confirmed and what still needs checking",
        "Use official links or pasted notes for precise details"
      ],
      visualPrompt: "Fact checklist layout",
      speakerNotes: sourceNote
    },
    {
      title: "Recommended Actions",
      layout: "bullets" as const,
      bullets: [
        "Confirm missing facts",
        "Add audience-specific examples",
        "Prepare the final version for sharing"
      ],
      visualPrompt: "Action checklist layout",
      speakerNotes: sourceNote
    }
  ];
}

function fallbackSubtitle(topic: string, request: DeckRequest): string {
  if (/\b(university|college|campus|school|institute)\b/i.test(topic)) {
    return "A clean campus overview for students, parents, and visitors";
  }
  return `A clean ${request.tone} presentation for ${request.audience}`;
}

function fallbackClosingBullets(topic: string): string[] {
  if (/\b(university|college|campus|school|institute)\b/i.test(topic)) {
    return [
      "Add official department and admission links",
      "Verify facilities, placements, and contact details",
      "Prepare a short Q&A for students and parents"
    ];
  }

  return ["Verify the facts", "Add audience-specific examples", "Share the final version"];
}

function parseUserSources(customContext?: string, assetLinks?: string): ResearchSource[] {
  const links = `${customContext ?? ""}\n${assetLinks ?? ""}`.match(/https?:\/\/[^\s)]+/g) ?? [];
  return links.map((url) => ({
    title: "User-provided link",
    url,
    sourceType: "user",
    snippet: "Provided by the requester."
  }));
}

function dedupeSources(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url || `${source.title}:${source.snippet}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
