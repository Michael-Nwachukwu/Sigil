/**
 * Sigil Protocol MCP Server
 *
 * Two transports:
 *   stdio  — default, for Claude Code / Claude Desktop local config
 *   http   — SSE-based, for remote agents; set MCP_HTTP_PORT to enable
 *
 * Tools:
 *   sigil__register_agent      — initiate or poll a sponsored registration
 *   sigil__resolve_agent       — read an AgentPassport from the registry
 *   sigil__notarize_output     — notarize an artifact on-chain (env key only)
 *   sigil__resolve_provenance  — resolve a ProvenanceRecord
 *   sigil__verify_agent        — trust gate: ACCEPT / CAUTION / REJECT
 *
 * Security:
 *   sigil__notarize_output reads SIGIL_AGENT_PRIVATE_KEY from env.
 *   Private keys are never accepted in tool call payloads.
 *   Remote SSE transport rejects sigil__notarize_output calls that carry
 *   a private key string in any argument (belt-and-suspenders check).
 */

import "dotenv/config";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

import { registerAgent, registerAgentSchema } from "./tools/register.js";
import { resolveAgent, resolveAgentSchema } from "./tools/resolve.js";
import { notarizeOutput, notarizeOutputSchema } from "./tools/notarize.js";
import { resolveProvenance, resolveProvenanceSchema } from "./tools/resolve-provenance.js";
import { verifyAgent, verifyAgentSchema } from "./tools/verify.js";

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const cfg = {
  rpcUrl: process.env.ZERO_G_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  chainId: Number(process.env.ZERO_G_CHAIN_ID ?? "16602"),
  registryAddress:
    process.env.SIGIL_REGISTRY_ADDRESS ?? "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
  notaryAddress:
    process.env.PROVENANCE_NOTARY_ADDRESS ?? "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
  storageRpc:
    process.env.ZERO_G_STORAGE_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai",
  apiBaseUrl: process.env.SIGIL_API_BASE_URL ?? "http://localhost:3000",
};

// ---------------------------------------------------------------------------
// Server factory — creates a fresh McpServer with all 5 tools registered.
// A new instance is created per SSE connection so each client gets its own
// request-processing context. In stdio mode, one instance serves one session.
// ---------------------------------------------------------------------------

function makeServer(remoteMode = false) {
  const server = new McpServer({
    name: "sigil-protocol",
    version: "0.1.0",
  });

  // sigil__register_agent
  server.tool(
    "sigil__register_agent",
    "Initiate a sponsored Sigil agent registration or poll an existing request. " +
      "Pass principalAddress + agentDescription + permissions to create a new request (returns approvalUrl). " +
      "Pass requestId to poll status — on approval the response includes passportId and agentPrivateKey (delivered once).",
    registerAgentSchema.shape,
    async (args) => {
      try {
        const result = await registerAgent(args as z.infer<typeof registerAgentSchema>, {
          apiBaseUrl: cfg.apiBaseUrl,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // sigil__resolve_agent
  server.tool(
    "sigil__resolve_agent",
    "Read a Sigil AgentPassport from the on-chain registry. " +
      "Accepts a passportId (0x+64 hex) or agent address (0x+40 hex).",
    resolveAgentSchema.shape,
    async (args) => {
      try {
        const result = await resolveAgent(args as z.infer<typeof resolveAgentSchema>, {
          rpcUrl: cfg.rpcUrl,
          registryAddress: cfg.registryAddress,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // sigil__notarize_output — blocked in remote mode if key leakage detected
  server.tool(
    "sigil__notarize_output",
    "Notarize an AI-generated artifact on 0G Chain. " +
      "Reads SIGIL_AGENT_PRIVATE_KEY from the server environment — never pass private keys in the tool arguments. " +
      "Returns recordId, txHash, and an explorer link.",
    notarizeOutputSchema.shape,
    async (args) => {
      // Belt-and-suspenders: reject if any arg value looks like a raw private key
      if (remoteMode) {
        const argsStr = JSON.stringify(args);
        if (/0x[0-9a-fA-F]{62,}/.test(argsStr)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: sigil__notarize_output via remote transport must not carry private key material in arguments. The server reads SIGIL_AGENT_PRIVATE_KEY from its own environment.",
              },
            ],
            isError: true,
          };
        }
      }
      try {
        const result = await notarizeOutput(args as z.infer<typeof notarizeOutputSchema>, {
          rpcUrl: cfg.rpcUrl,
          chainId: cfg.chainId,
          registryAddress: cfg.registryAddress,
          notaryAddress: cfg.notaryAddress,
          storageRpc: cfg.storageRpc,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // sigil__resolve_provenance
  server.tool(
    "sigil__resolve_provenance",
    "Resolve a Sigil ProvenanceRecord from on-chain. " +
      "Accepts recordId (bytes32), outputHash (keccak256 of the artifact), or passportId (to list all records).",
    resolveProvenanceSchema.shape,
    async (args) => {
      try {
        const result = await resolveProvenance(args as z.infer<typeof resolveProvenanceSchema>, {
          rpcUrl: cfg.rpcUrl,
          notaryAddress: cfg.notaryAddress,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // sigil__verify_agent
  server.tool(
    "sigil__verify_agent",
    "Trust-gate another agent's Sigil passport. " +
      "Returns ACCEPT (reputation ≥ 600, no failures), CAUTION (200–599 or has failures), or REJECT (< 200 or revoked).",
    verifyAgentSchema.shape,
    async (args) => {
      try {
        const result = await verifyAgent(args as z.infer<typeof verifyAgentSchema>, {
          rpcUrl: cfg.rpcUrl,
          registryAddress: cfg.registryAddress,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Transport selection
// ---------------------------------------------------------------------------

const httpPort = process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : null;

if (httpPort) {
  // ── SSE / HTTP mode ───────────────────────────────────────────────────────
  // Remote agents connect to GET /sse and send messages to POST /message.
  // Each connection gets its own McpServer instance.

  const app = express();
  app.use(express.json());

  // Health check — useful for load balancers and uptime monitors
  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: "sigil-mcp", version: "0.1.0" });
  });

  // SKILL.md — serve so remote agents can discover onboarding instructions
  // from the same host as the MCP server
  app.get("/skill.md", (_req, res) => {
    res.redirect(301, `${cfg.apiBaseUrl}/SKILL.md`);
  });

  // Active SSE sessions: sessionId → transport
  const sessions = new Map<string, SSEServerTransport>();

  app.get("/sse", (req, res) => {
    const transport = new SSEServerTransport("/message", res);
    const server = makeServer(true); // remote mode

    sessions.set(transport.sessionId, transport);
    res.on("close", () => {
      sessions.delete(transport.sessionId);
    });

    server.connect(transport).catch((err) => {
      console.error("SSE connect error:", err);
    });
  });

  app.post("/message", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query param" });
      return;
    }
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: `Session ${sessionId} not found` });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // CORS headers so browser-based agents can connect
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  app.listen(httpPort, () => {
    console.error(
      `[sigil-mcp] SSE transport listening on http://0.0.0.0:${httpPort}/sse`,
    );
    console.error(`[sigil-mcp] Health: http://0.0.0.0:${httpPort}/health`);
  });
} else {
  // ── Stdio mode (default) ──────────────────────────────────────────────────
  const server = makeServer(false);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
