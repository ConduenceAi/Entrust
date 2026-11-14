export interface AgentPlatform {
  id: string;
  name: string;
  type: string;
  initials: string;
  aliases?: string;
  setup?: string;
  /** Cloud platforms cannot start a program on your computer, so they connect through your own gateway. */
  gateway?: GatewayRecipe;
}

export interface GatewayRecipe {
  /** `mcp` platforms take a connector URL. `http` platforms call the REST API with a Bearer header. */
  kind: "mcp" | "http";
  steps: string[];
}

const MENU_NOTE = "Menu names change; if a step does not match, use the product's current documentation for adding a remote MCP server or calling an HTTP API.";

export const platforms: AgentPlatform[] = [
  { id: "claude-desktop", name: "Claude Desktop", type: "Chat assistants", initials: "CL", aliases: "anthropic local mcp", setup: "Merge the mcpServers entry into claude_desktop_config.json, then fully quit and reopen the app." },
  {
    id: "chatgpt", name: "ChatGPT", type: "Chat assistants", initials: "CG", aliases: "openai remote mcp gateway",
    gateway: { kind: "mcp", steps: [
      "Open ChatGPT settings and find Connectors (turn on developer mode under advanced settings if you cannot create a custom connector).",
      "Create a connector named NEARFirewall and paste the MCP server URL below. The secret is already in the URL, so choose no authentication.",
      "Enable the connector in a chat, then ask: What can you spend?",
      MENU_NOTE,
    ] },
  },
  {
    id: "n8n", name: "n8n", type: "Workflow automation", initials: "n8", aliases: "remote mcp http gateway workflow",
    gateway: { kind: "mcp", steps: [
      "In your workflow, add an AI Agent node, then add an MCP Client Tool node under its tools.",
      "Set the endpoint to the MCP server URL below. The secret is in the URL, so no extra authentication is needed.",
      "Or call the REST API with HTTP Request nodes: send the Bearer token as a credential, never typed into a node.",
      "Ask the agent what it can spend, then run a small payment to an approved recipient.",
      MENU_NOTE,
    ] },
  },
  { id: "claude-code", name: "Claude Code", type: "Coding agents", initials: "CC", aliases: "anthropic local mcp", setup: "Merge the mcpServers entry into your local user MCP configuration and check the connection with /mcp." },
  { id: "cursor", name: "Cursor", type: "Coding agents", initials: "CU", aliases: "local mcp", setup: "Merge the mcpServers entry into your user-level ~/.cursor/mcp.json and reload the editor." },
  {
    id: "claude-web", name: "Claude on the web", type: "Chat assistants", initials: "CW", aliases: "anthropic claude.ai remote mcp gateway",
    gateway: { kind: "mcp", steps: [
      "Open Claude settings, then Connectors, then add a custom connector.",
      "Name it NEARFirewall and paste the MCP server URL below. The secret is already in the URL.",
      "Turn the connector on in a chat, then ask: What can you spend?",
      MENU_NOTE,
    ] },
  },
  {
    id: "gumloop", name: "Gumloop", type: "Workflow automation", initials: "GL", aliases: "workflow http mcp gateway",
    gateway: { kind: "http", steps: [
      "Add an MCP node if your plan has one and use the MCP server URL below. Otherwise add an HTTP request node.",
      "For HTTP, call the REST API below with the header Authorization: Bearer <token>, with the token kept in Gumloop's secrets or credentials.",
      "Ask for GET /api/rules first, then POST /api/pay with a recipient and amount_near.",
      MENU_NOTE,
    ] },
  },
  { id: "copilot-studio", name: "Microsoft Copilot Studio", type: "Chat assistants", initials: "CS" },
  { id: "codex", name: "Codex", type: "Coding agents", initials: "CX", aliases: "openai local mcp", setup: "Add the TOML entry to ~/.codex/config.toml and start a new Codex session." },
  { id: "vscode", name: "VS Code", type: "Coding agents", initials: "VS", aliases: "copilot", setup: "Open MCP: Open User Configuration from the Command Palette and merge the servers entry. Start the server in VS Code." },
  { id: "windsurf", name: "Windsurf", type: "Coding agents", initials: "WS" },
  {
    id: "zapier", name: "Zapier", type: "Workflow automation", initials: "ZA", aliases: "http webhook gateway",
    gateway: { kind: "http", steps: [
      "Add a step that sends a custom HTTP request (for example Webhooks by Zapier with a custom request).",
      "Call the REST API below with the header Authorization: Bearer <token> and a JSON body.",
      "Start with GET /api/rules, then POST /api/pay with recipient and amount_near.",
      MENU_NOTE,
    ] },
  },
  {
    id: "make", name: "Make", type: "Workflow automation", initials: "MK", aliases: "http gateway",
    gateway: { kind: "http", steps: [
      "Add an HTTP module that makes a request.",
      "Call the REST API below with the header Authorization: Bearer <token> and a JSON body.",
      "Start with GET /api/rules, then POST /api/pay with recipient and amount_near.",
      MENU_NOTE,
    ] },
  },
  { id: "langgraph", name: "LangChain / LangGraph", type: "Agent frameworks", initials: "LG" },
  { id: "near-ai", name: "NEAR AI agents", type: "Web3 agent kits", initials: "NA" },
  { id: "custom", name: "Custom local MCP client", type: "Custom", initials: "<>", aliases: "sdk stdio", setup: "Configure your client to launch the local MCP server over stdio with this command, argument and environment." },
];

const featuredIcons: Record<string, string> = {
  "claude-desktop": "claude.svg",
  "claude-code": "claude-code.svg",
  cursor: "cursor.svg",
  codex: "codex.svg",
  vscode: "vscode.png",
};

export const featuredPlatforms = platforms.filter(({ id }) =>
  ["claude-desktop", "claude-code", "cursor", "codex", "vscode"].includes(id)
).map((platform) => ({ ...platform, icon: featuredIcons[platform.id] }));

const SERVER_PLACEHOLDER = "/absolute/path/to/NEARFirewall/packages/mcp/src/main.ts";

/**
 * One terminal command that adds the MCP server to Claude Code for the current
 * user. It holds the key, so it is shown only once, like the key itself.
 */
export function claudeCodeCommand(env: Record<string, string>, serverPath = "") {
  const vars = Object.entries(env).map(([key, value]) => `-e ${key}=${value}`).join(" ");
  return `claude mcp add nearfirewall --scope user ${vars} -- node "${serverPath || SERVER_PLACEHOLDER}"`;
}

export function localMcpConfig(platform: AgentPlatform, env: Record<string, string>, serverPath = "") {
  const command = "node";
  const args = [serverPath || SERVER_PLACEHOLDER];
  if (platform.id === "codex") {
    return [
      "[mcp_servers.nearfirewall]",
      "command = " + JSON.stringify(command),
      "args = " + JSON.stringify(args),
      "",
      "[mcp_servers.nearfirewall.env]",
      ...Object.entries(env).map(([key, value]) => key + " = " + JSON.stringify(value)),
    ].join("\n");
  }
  if (platform.id === "vscode") {
    return JSON.stringify({ servers: { nearfirewall: { type: "stdio", command, args, env } } }, null, 2);
  }
  return JSON.stringify({ mcpServers: { nearfirewall: { command, args, env } } }, null, 2);
}

export function searchPlatforms(query: string): AgentPlatform[] {
  const words = query.toLowerCase().trim().split(/\s+/);
  return platforms.filter((p) => words.every((word) => `${p.name} ${p.type} ${p.aliases ?? ""}`.toLowerCase().includes(word)));
}
