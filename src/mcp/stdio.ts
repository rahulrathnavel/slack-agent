import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DeckAgent } from "../agent/deckAgent.js";
import { createMcpServer } from "./server.js";

const server = createMcpServer(new DeckAgent());
const transport = new StdioServerTransport();

await server.connect(transport);
