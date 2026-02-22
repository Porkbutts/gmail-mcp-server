import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as gmail from "../services/gmail.js";

export function registerReadTools(server: McpServer) {
  server.tool(
    "gmail_list_messages",
    "List/search Gmail messages. Supports Gmail search query syntax (e.g. 'from:boss is:unread'). Returns message summaries with IDs for use with gmail_get_message.",
    {
      query: z.string().optional().describe("Gmail search query (e.g. 'is:unread', 'from:alice subject:meeting')"),
      maxResults: z.number().min(1).max(100).optional().describe("Max messages to return (default 20, max 100)"),
      pageToken: z.string().optional().describe("Page token for pagination (from previous response's nextPageToken)"),
      labelIds: z.array(z.string()).optional().describe("Filter by label IDs (e.g. ['INBOX', 'UNREAD'])"),
    },
    async (params) => {
      const result = await gmail.listMessages(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "gmail_get_message",
    "Get full email message by ID. Returns subject, from, to, cc, date, decoded body text, labels, and attachment metadata.",
    {
      messageId: z.string().describe("The message ID (from gmail_list_messages)"),
    },
    async ({ messageId }) => {
      const result = await gmail.getMessage(messageId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "gmail_download_attachment",
    "Download an email attachment to disk. Use attachmentId from gmail_get_message response. Returns the saved file path and metadata.",
    {
      messageId: z.string().describe("The message ID containing the attachment"),
      attachmentId: z.string().describe("The attachment ID (from gmail_get_message attachments array)"),
      filename: z.string().describe("Filename for the saved attachment"),
      savePath: z.string().optional().describe("Absolute path to save the file (defaults to /tmp/<filename>)"),
    },
    async (params) => {
      const result = await gmail.getAttachment(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "gmail_list_labels",
    "List all Gmail labels (INBOX, SENT, custom labels). Useful for discovering label IDs to filter messages.",
    {},
    async () => {
      const result = await gmail.listLabels();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
