import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as gmail from "../services/gmail.js";

export function registerWriteTools(server: McpServer) {
  server.tool(
    "gmail_send_message",
    "Send an email via Gmail. Constructs and sends an RFC 2822 message.",
    {
      to: z.string().describe("Recipient email address(es), comma-separated for multiple"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text (plain text)"),
      cc: z.string().optional().describe("CC recipients, comma-separated"),
      bcc: z.string().optional().describe("BCC recipients, comma-separated"),
    },
    async (params) => {
      const result = await gmail.sendMessage(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "gmail_create_draft",
    "Create a draft email in Gmail. Returns the draft ID. The draft can be reviewed and sent from the Gmail UI.",
    {
      to: z.string().describe("Recipient email address(es), comma-separated for multiple"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text (plain text)"),
      cc: z.string().optional().describe("CC recipients, comma-separated"),
      bcc: z.string().optional().describe("BCC recipients, comma-separated"),
    },
    async (params) => {
      const result = await gmail.createDraft(params);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "gmail_reply_to_message",
    "Reply to an existing email message. Preserves threading so the reply appears in the same conversation.",
    {
      messageId: z.string().describe("The message ID to reply to (from gmail_list_messages or gmail_get_message)"),
      body: z.string().describe("Reply body text (plain text)"),
    },
    async ({ messageId, body }) => {
      const result = await gmail.replyToMessage(messageId, body);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
