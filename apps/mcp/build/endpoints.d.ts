/**
 * Endpoint definitions for Haltija MCP
 *
 * This is a simplified copy of the main api-schema.ts that doesn't require
 * tosijs-schema dependency. We only need the endpoint metadata and JSON schemas.
 */
export interface EndpointDef {
    path: string;
    method: 'GET' | 'POST';
    summary: string;
    description?: string;
    inputSchema?: {
        type: "object";
        properties?: Record<string, unknown>;
        required?: string[];
    };
}
export declare function getInputSchema(ep: EndpointDef): object | undefined;
export declare const ALL_ENDPOINTS: EndpointDef[];
