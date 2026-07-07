export type Audience =
  | "executives"
  | "sales"
  | "engineering"
  | "customers"
  | "investors"
  | "training"
  | "general";

export type Tone =
  | "executive"
  | "persuasive"
  | "technical"
  | "friendly"
  | "bold"
  | "educational";

export type BrandStyle =
  | "executive-clean"
  | "startup-bright"
  | "editorial"
  | "dark-stage"
  | "minimal";

export type SlideTransition = "slide" | "fade" | "zoom" | "none";

export type DeckTransition = SlideTransition | "varied";

export type ImagePlacement = "right" | "left" | "background" | "full";

export interface DeckRequest {
  topic: string;
  title?: string;
  presenters: string[];
  audience: Audience;
  slideCount: number;
  tone: Tone;
  brandStyle: BrandStyle;
  useSlackContext: boolean;
  useWebResearch: boolean;
  useLicensedImages: boolean;
  includeCitations: boolean;
  includeSpeakerNotes: boolean;
  includeVideoLinks: boolean;
  customContext?: string;
  assetLinks?: string;
  advancedPrompt?: string;
  transition?: DeckTransition;
  slideTransitions?: Record<number, SlideTransition>;
  requesterUserId?: string;
  channelId?: string;
  threadTs?: string;
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
  sourceType: "web" | "slack" | "asset" | "user";
  author?: string;
  publishedDate?: string;
}

export interface DeckAsset {
  title: string;
  url: string;
  thumbnailUrl?: string;
  creator?: string;
  creatorUrl?: string;
  license?: string;
  licenseUrl?: string;
  source?: string;
  slideIndex?: number;
  placement?: ImagePlacement;
}

export interface SlidePlan {
  title: string;
  subtitle?: string;
  layout: "title" | "section" | "image" | "bullets" | "quote" | "comparison" | "timeline" | "closing";
  bullets: string[];
  visualPrompt?: string;
  imageQuery?: string;
  speakerNotes?: string;
  citationUrls?: string[];
}

export interface DeckPlan {
  title: string;
  subtitle: string;
  presenters: string[];
  narrative: string;
  slides: SlidePlan[];
  sources: ResearchSource[];
  recommendedFollowups: string[];
}

export interface GeneratedDeck {
  deckId: string;
  title: string;
  publicUrl: string;
  localDir: string;
  plan: DeckPlan;
  sources: ResearchSource[];
  assets: DeckAsset[];
}

export interface SlackContextSearchResult {
  sources: ResearchSource[];
  text: string;
  unavailableReason?: string;
}
