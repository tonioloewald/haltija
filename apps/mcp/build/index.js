#!/usr/bin/env node
/**
 * Haltija MCP Server
 *
 * Exposes Haltija browser control as MCP tools.
 * Tools are auto-generated from endpoint definitions.
 *
 * Usage:
 *   haltija-mcp                    # Connect to localhost:8700
 *   haltija-mcp --port 8701        # Connect to custom port
 *   HALTIJA_URL=http://... haltija-mcp  # Full URL override
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
// Import generated endpoints JSON (built from api-schema.ts - single source of truth)
import endpoints from "./endpoints.json" with { type: "json" };
const ALL_ENDPOINTS = endpoints;
function getInputSchema(ep) {
    return ep.inputSchema;
}
// Configuration
const DEFAULT_PORT = 8700;
const portArg = process.argv.indexOf('--port');
const port = process.env.HALTIJA_PORT || (portArg !== -1 ? process.argv[portArg + 1] : DEFAULT_PORT);
const baseUrl = process.env.HALTIJA_URL || `http://localhost:${port}`;
// Create MCP server
const server = new McpServer({
    name: "haltija",
    version: "0.1.0",
});
// Helper to convert endpoint path to tool name
// /events/watch -> events_watch
function pathToToolName(path) {
    return path.slice(1).replace(/\//g, '_');
}
// Helper to call Haltija REST API
async function callHaltija(endpoint, args) {
    const url = `${baseUrl}${endpoint.path}`;
    const options = {
        method: endpoint.method,
        headers: {
            'Content-Type': 'application/json',
        },
    };
    if (endpoint.method === 'POST') {
        options.body = JSON.stringify(args);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Haltija API error: ${response.status} - ${error}`);
    }
    return response.json();
}
// Convert JSON Schema to Zod schema (simplified)
function jsonSchemaToZod(schema) {
    if (!schema) {
        return z.object({});
    }
    const s = schema;
    if (!s.properties) {
        return z.object({});
    }
    const shape = {};
    for (const [key, prop] of Object.entries(s.properties)) {
        const p = prop;
        let zodType;
        switch (p.type) {
            case 'string':
                zodType = z.string();
                break;
            case 'number':
                zodType = z.number();
                break;
            case 'boolean':
                zodType = z.boolean();
                break;
            case 'array':
                zodType = z.array(z.string()); // simplified
                break;
            default:
                zodType = z.any();
        }
        if (p.description) {
            zodType = zodType.describe(p.description);
        }
        // Make optional unless in required array
        if (!s.required?.includes(key)) {
            zodType = zodType.optional();
        }
        shape[key] = zodType;
    }
    return z.object(shape);
}
// Register each endpoint as an MCP tool
for (const endpoint of ALL_ENDPOINTS) {
    const toolName = pathToToolName(endpoint.path);
    const description = endpoint.description || endpoint.summary;
    const inputSchema = getInputSchema(endpoint);
    const schemaProps = inputSchema?.properties;
    if (inputSchema && schemaProps && Object.keys(schemaProps).length > 0) {
        // Tool with parameters
        const zodSchema = jsonSchemaToZod(inputSchema);
        server.tool(toolName, description, zodSchema.shape, async (args) => {
            try {
                const result = await callHaltija(endpoint, args);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            catch (error) {
                return {
                    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                    isError: true,
                };
            }
        });
    }
    else {
        // Tool without parameters
        server.tool(toolName, description, async () => {
            try {
                const result = await callHaltija(endpoint, {});
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            }
            catch (error) {
                return {
                    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                    isError: true,
                };
            }
        });
    }
}
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Haltija MCP server running, connecting to ${baseUrl}`);
}
main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
