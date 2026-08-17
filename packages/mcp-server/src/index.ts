import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openTree } from "@kinbook/sync";
import type { Actions } from "@kinbook/core";

const TOOLS = [
  {
    name: "add_person",
    description: "Add a new person to the family tree, optionally linking into a family.",
    inputSchema: {
      type: "object",
      properties: {
        given: { type: "string", description: "Given / first name" },
        surname: { type: "string", description: "Surname" },
        sex: { type: "string", enum: ["male", "female", "other", "unknown"] },
        familyId: { type: "string", description: "Existing family id to auto-link into" },
        role: { type: "string", enum: ["child", "spouse"] },
      },
    },
  },
  {
    name: "search_tree",
    description: "Search the family tree by name or query.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query" } },
    },
  },
  {
    name: "export_tree",
    description:
      "Export the tree to GEDCOM (5.5.5 or 7.0) or a FHIR R5 Bundle of FamilyMemberHistory resources. fhir5 requires patientId: the node id of the person who is the Patient.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["gedcom55", "gedcom70", "fhir5"] },
        patientId: { type: "string", description: "Person node id for the FHIR Patient (fhir5 only)" },
      },
    },
  },
] as const;

/** Agent-facing MCP server. Thin adapter over the shared core actions. */
export function createServer(dbFile: string | undefined): {
  server: Server;
  actions: Actions;
} {
  const { actions } = openTree(dbFile);

  const server = new Server(
    { name: "kinbook", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments as Record<string, unknown>) ?? {};

    try {
      switch (name) {
        case "add_person": {
          const p = await actions.addPerson({
            given: String(args.given),
            surnames: args.surname ? [String(args.surname)] : [],
            sex: coerceSex(args.sex),
            familyId: args.familyId ? String(args.familyId) : undefined,
            role: args.role === "spouse" ? "spouse" : "child",
          });
          return { content: [{ type: "text", text: JSON.stringify(p) }] };
        }
        case "search_tree": {
          const res = await actions.search(String(args.query));
          return {
            content: [{ type: "text", text: JSON.stringify(res.map((r) => r.person)) }],
          };
        }
        case "export_tree": {
          const out = await actions.exportTree(
            args.format as "gedcom55" | "gedcom70" | "fhir5",
            args.patientId ? String(args.patientId) : undefined,
          );
          return { content: [{ type: "text", text: out }] };
        }
        default:
          throw new Error(`unknown tool: ${name}`);
      }
    } catch (e) {
      return { content: [], isError: true, error: String(e) };
    }
  });

  return { server, actions };
}

export async function run(dbFile: string | undefined): Promise<void> {
  const { server } = createServer(dbFile);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function coerceSex(v: unknown): "male" | "female" | "other" | "unknown" {
  return v === "male" || v === "female" || v === "other" ? v : "unknown";
}

const dbArg = process.argv.indexOf("--db");
const dbFile = dbArg >= 0 ? process.argv[dbArg + 1] : undefined;
void run(dbFile);