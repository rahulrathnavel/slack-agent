import type { KnownBlock, ModalView } from "@slack/types";
import type { Audience, BrandStyle, DeckRequest, Tone } from "../types.js";

export const ACTION_OPEN_WIZARD = "open_deck_wizard";
export const ACTION_QUICK_DRAFT = "quick_draft_deck";
export const ACTION_OPEN_REVISE = "open_revise_deck";
export const VIEW_DECK_WIZARD = "deck_wizard_submit";
export const VIEW_REVISE_DECK = "revise_deck_submit";

export const EMPTY_BUTTON_VALUE = "__empty__";

const audienceOptions: Array<{ text: string; value: Audience }> = [
  { text: "Executives", value: "executives" },
  { text: "Sales team", value: "sales" },
  { text: "Engineering", value: "engineering" },
  { text: "Customers", value: "customers" },
  { text: "Investors", value: "investors" },
  { text: "Training", value: "training" },
  { text: "General audience", value: "general" }
];

const toneOptions: Array<{ text: string; value: Tone }> = [
  { text: "Executive", value: "executive" },
  { text: "Persuasive", value: "persuasive" },
  { text: "Technical", value: "technical" },
  { text: "Friendly", value: "friendly" },
  { text: "Bold", value: "bold" },
  { text: "Educational", value: "educational" }
];

const styleOptions: Array<{ text: string; value: BrandStyle }> = [
  { text: "Executive clean", value: "executive-clean" },
  { text: "Startup bright", value: "startup-bright" },
  { text: "Editorial", value: "editorial" },
  { text: "Dark stage", value: "dark-stage" },
  { text: "Minimal", value: "minimal" }
];

export function startBlocks(prefillTopic?: string): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*PioltPPT* creates live presentation websites from Slack context, web research, and your own notes. Start with a topic, messy draft, uploaded files, or links."
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Create deck" },
          style: "primary",
          action_id: ACTION_OPEN_WIZARD,
          value: prefillTopic || EMPTY_BUTTON_VALUE
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Quick draft" },
          action_id: ACTION_QUICK_DRAFT,
          value: prefillTopic || EMPTY_BUTTON_VALUE
        }
      ]
    }
  ];
}

export function deckWizardModal(metadata: {
  channelId?: string;
  threadTs?: string;
  prefillTopic?: string;
}): ModalView {
  return {
    type: "modal",
    callback_id: VIEW_DECK_WIZARD,
    title: { type: "plain_text", text: "PioltPPT" },
    submit: { type: "plain_text", text: "Generate" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify(metadata),
    blocks: [
      inputText("topic", "topic", "Topic or rough prompt", false, {
        placeholder: "Example: Q3 GTM launch plan for enterprise customers",
        initialValue: metadata.prefillTopic
      }),
      inputText("presenters", "presenters", "Presenter names", true, {
        placeholder: "Example: Rahul, Maya, Product Team"
      }),
      inputSelect("audience", "audience", "Audience", audienceOptions, "executives"),
      inputSelect(
        "slide_count",
        "slide_count",
        "Slide count",
        [4, 5, 6, 7, 8, 9, 10, 12].map((count) => ({ text: `${count} slides`, value: String(count) })),
        "7"
      ),
      inputSelect("tone", "tone", "Tone", toneOptions, "executive"),
      inputSelect("brand", "brand", "Brand style", styleOptions, "executive-clean"),
      {
        type: "input",
        block_id: "research",
        label: { type: "plain_text", text: "Research and context" },
        element: {
          type: "checkboxes",
          action_id: "research",
          initial_options: [
            checkboxOption("Use Slack context", "slack_context"),
            checkboxOption("Use web research", "web_research"),
            checkboxOption("Include source citations", "citations"),
            checkboxOption("Speaker notes", "speaker_notes")
          ],
          options: [
            checkboxOption("Use Slack context", "slack_context"),
            checkboxOption("Use web research", "web_research"),
            checkboxOption("Include source citations", "citations"),
            checkboxOption("Speaker notes", "speaker_notes"),
            checkboxOption("Video links when useful", "video_links")
          ]
        }
      },
      inputText("assets", "assets", "Custom files, links, or references", true, {
        multiline: true,
        placeholder:
          "Optional image URLs. Examples: slide 2: image right https://example.com/photo.jpg | slide 3: image full https://example.com/chart.png"
      }),
      inputText("context", "context", "Messy notes or source context", true, {
        multiline: true,
        placeholder: "Paste rough draft, chat excerpts, meeting notes, PDFs text, customer notes, CSV summary, or any context."
      }),
      inputText("advanced_prompt", "advanced_prompt", "Advanced customization prompt", true, {
        multiline: true,
        placeholder:
          "Examples: transition: fade | slide 2: transition zoom | slide 2: image right https://example.com/photo.jpg | slide 3: no image"
      })
    ]
  };
}

export function workingBlocks(request: DeckRequest): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Creating *${request.title || request.topic}* as a live presentation site. I will gather the selected context, build the outline, render the deck, and return a public link.`
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${request.slideCount} slides | ${request.audience} | ${request.tone} | ${request.brandStyle}`
        }
      ]
    }
  ];
}

export function finishedBlocks(params: {
  deckId: string;
  title: string;
  publicUrl: string;
  sourceCount: number;
  assetCount: number;
}): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.title}* is ready as a live presentation website.\nDeck ID: \`${params.deckId}\``
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open deck" },
          url: params.publicUrl,
          action_id: "open_generated_deck"
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Revise deck" },
          action_id: ACTION_OPEN_REVISE,
          value: JSON.stringify({ deckId: params.deckId, publicUrl: params.publicUrl })
        }
      ]
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${params.sourceCount} sources | ${params.assetCount} user images | keyboard controls and print/PDF mode included`
        }
      ]
    }
  ];
}

export function reviseDeckModal(metadata: {
  deckId: string;
  publicUrl?: string;
  channelId?: string;
  threadTs?: string;
}): ModalView {
  return {
    type: "modal",
    callback_id: VIEW_REVISE_DECK,
    title: { type: "plain_text", text: "Revise deck" },
    submit: { type: "plain_text", text: "Update" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify(metadata),
    blocks: [
      inputText("deck_id", "deck_id", "Deck ID", false, {
        initialValue: metadata.deckId,
        placeholder: "Paste a PioltPPT deck ID"
      }),
      inputText("revision", "revision", "Revision instruction", false, {
        multiline: true,
        placeholder:
          "Example: make slide 3 more executive, add a stronger ROI story, reduce text, and make the closing slide more action-oriented."
      })
    ]
  };
}

export function parseRevisionFromView(view: {
  state: { values: Record<string, Record<string, any>> };
  private_metadata?: string;
}): {
  deckId: string;
  instruction: string;
  channelId?: string;
  threadTs?: string;
} {
  const metadata = view.private_metadata ? JSON.parse(view.private_metadata) : {};
  return {
    deckId: plainTextValue(view.state.values, "deck_id", "deck_id"),
    instruction: plainTextValue(view.state.values, "revision", "revision"),
    channelId: metadata.channelId,
    threadTs: metadata.threadTs
  };
}

export function parseDeckRequestFromView(view: {
  state: { values: Record<string, Record<string, any>> };
  private_metadata?: string;
}, userId: string): DeckRequest {
  const values = view.state.values as Record<string, Record<string, any>>;
  const metadata = view.private_metadata ? JSON.parse(view.private_metadata) : {};
  const checks = selectedCheckboxValues(values, "research", "research");
  const topic = plainTextValue(values, "topic", "topic");
  const presenters = plainTextValue(values, "presenters", "presenters")
    .split(/,|\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    topic,
    title: topic,
    presenters,
    audience: selectedValue(values, "audience", "audience", "executives") as Audience,
    slideCount: Number(selectedValue(values, "slide_count", "slide_count", "7")),
    tone: selectedValue(values, "tone", "tone", "executive") as Tone,
    brandStyle: selectedValue(values, "brand", "brand", "executive-clean") as BrandStyle,
    useSlackContext: checks.includes("slack_context"),
    useWebResearch: checks.includes("web_research"),
    useLicensedImages: checks.includes("licensed_images"),
    includeCitations: checks.includes("citations"),
    includeSpeakerNotes: checks.includes("speaker_notes"),
    includeVideoLinks: checks.includes("video_links"),
    assetLinks: plainTextValue(values, "assets", "assets"),
    customContext: plainTextValue(values, "context", "context"),
    advancedPrompt: plainTextValue(values, "advanced_prompt", "advanced_prompt"),
    requesterUserId: userId,
    channelId: metadata.channelId,
    threadTs: metadata.threadTs
  };
}

export function quickDraftRequest(topic: string, userId: string, channelId?: string, threadTs?: string): DeckRequest {
  const [topicInput = "", ...controlParts] = topic.split(/\s*\|\s*/);
  const cleanTopic = normalizeQuickTopic(topicInput) || "A practical presentation";
  const advancedPrompt = controlParts.map((part) => part.trim()).filter(Boolean).join(" | ");
  const isEducationOverview = /\b(university|college|campus|school|institute|overview)\b/i.test(cleanTopic);
  const isExecutive = /\b(executive|leadership|board|investor|readiness|launch|strategy)\b/i.test(cleanTopic);

  return {
    topic: cleanTopic,
    title: cleanTopic,
    presenters: [],
    audience: isExecutive ? "executives" : "general",
    slideCount: 6,
    tone: isEducationOverview && !isExecutive ? "educational" : "executive",
    brandStyle: "executive-clean",
    useSlackContext: false,
    useWebResearch: true,
    useLicensedImages: false,
    includeCitations: true,
    includeSpeakerNotes: true,
    includeVideoLinks: false,
    advancedPrompt: advancedPrompt || undefined,
    requesterUserId: userId,
    channelId,
    threadTs
  };
}

function normalizeQuickTopic(topic: string): string {
  return topic
    .trim()
    .replace(/^\s*(launch|create|make|generate|build)\s+(a\s+|an\s+|the\s+)?(ppt|deck|presentation|slides?)?\s*(about|on|for)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inputText(
  blockId: string,
  actionId: string,
  label: string,
  optional: boolean,
  options: { multiline?: boolean; placeholder?: string; initialValue?: string } = {}
): KnownBlock {
  return {
    type: "input",
    block_id: blockId,
    optional,
    label: { type: "plain_text", text: label },
    element: {
      type: "plain_text_input",
      action_id: actionId,
      multiline: options.multiline ?? false,
      placeholder: options.placeholder ? { type: "plain_text", text: options.placeholder } : undefined,
      initial_value: options.initialValue
    }
  };
}

function inputSelect<T extends string>(
  blockId: string,
  actionId: string,
  label: string,
  options: Array<{ text: string; value: T }>,
  initialValue: T
): KnownBlock {
  const slackOptions = options.map((option) => ({
    text: { type: "plain_text" as const, text: option.text },
    value: option.value
  }));

  return {
    type: "input",
    block_id: blockId,
    label: { type: "plain_text", text: label },
    element: {
      type: "static_select",
      action_id: actionId,
      initial_option: slackOptions.find((option) => option.value === initialValue),
      options: slackOptions
    }
  };
}

function checkboxOption(text: string, value: string) {
  return {
    text: { type: "plain_text" as const, text },
    value
  };
}

function plainTextValue(values: Record<string, Record<string, any>>, blockId: string, actionId: string): string {
  return values[blockId]?.[actionId]?.value?.trim() ?? "";
}

function selectedValue(
  values: Record<string, Record<string, any>>,
  blockId: string,
  actionId: string,
  fallback: string
): string {
  return values[blockId]?.[actionId]?.selected_option?.value ?? fallback;
}

function selectedCheckboxValues(values: Record<string, Record<string, any>>, blockId: string, actionId: string): string[] {
  return (values[blockId]?.[actionId]?.selected_options ?? []).map((option: { value: string }) => option.value);
}
