import type { WebClient } from "@slack/web-api";
import { describe, expect, it, vi } from "vitest";
import { buildSlackQuery, searchSlackContext } from "../src/services/slackSearch.js";

describe("Slack evidence search", () => {
  it("builds inclusive date and person filters", () => {
    expect(buildSlackQuery("launch decision", "2026-07-01", "2026-07-10", "<@U123>")).toBe(
      "launch decision after:2026-07-01 before:2026-07-11 from:<@U123>"
    );
  });

  it("uses mocked Slack APIs and returns grounded author/date evidence", async () => {
    let assistantArgs: Record<string, unknown> | undefined;
    let exactQuery = "";
    const client = {
      users: {
        list: vi.fn(async () => ({ members: [{ id: "U123", name: "rahul", real_name: "Rahul Rathnavel", profile: { display_name: "Rahul" } }] }))
      },
      apiCall: vi.fn(async (_method: string, args: Record<string, unknown>) => {
        assistantArgs = args;
        return {
          ok: true,
          results: {
            messages: [{ author_name: "Rahul", channel_name: "product", content: "Ship after the security review.", permalink: "https://example.slack.com/archives/C1/p1", message_ts: "1783728000.000000" }]
          }
        };
      }),
      search: {
        messages: vi.fn(async ({ query }: { query: string }) => {
          exactQuery = query;
          return { messages: { matches: [] } };
        })
      }
    } as unknown as WebClient;

    const result = await searchSlackContext({
      query: "launch decision",
      fromDate: "2026-07-01",
      toDate: "2026-07-10",
      person: "Rahul",
      client
    });

    expect(assistantArgs?.query).toBe("launch decision after:2026-07-01 before:2026-07-11 from:<@U123>");
    expect(exactQuery).toBe(assistantArgs?.query);
    expect(result.sources[0]).toMatchObject({ author: "Rahul", title: "Slack: #product", publishedDate: expect.stringMatching(/^2026-/) });
    expect(result.text).toContain("Ship after the security review.");
  });

  it("explains missing Slack search scopes without claiming evidence", async () => {
    const client = {
      users: { list: vi.fn(async () => ({ members: [] })) },
      apiCall: vi.fn(async () => ({ ok: false, error: "missing_scope" })),
      search: { messages: vi.fn(async () => { throw Object.assign(new Error("missing_scope"), { data: { error: "missing_scope" } }); }) }
    } as unknown as WebClient;

    const result = await searchSlackContext({ query: "decision", client });
    expect(result.sources).toEqual([]);
    expect(result.unavailableReason).toContain("authorized user token");
  });
});
