import { gmail_v1 } from "googleapis";
import { getGmailClient } from "../auth.js";

let gmail: gmail_v1.Gmail;

function client() {
  if (!gmail) {
    gmail = getGmailClient();
  }
  return gmail;
}

// --- Helpers ---

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function encodeBase64Url(data: string): string {
  return Buffer.from(data, "utf-8").toString("base64url");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  // Simple body (no parts)
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") return decoded;
    if (payload.mimeType === "text/html") return stripHtmlTags(decoded);
    return decoded;
  }

  // Multipart — prefer text/plain
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return stripHtmlTags(decodeBase64Url(htmlPart.body.data));
    }

    // Recurse into nested multipart
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  return "";
}

function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): Array<{ filename: string; mimeType: string; size: number }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number }> = [];
  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
      });
    }
    // Recurse
    if (part.parts) {
      attachments.push(...extractAttachments(part));
    }
  }

  return attachments;
}

// --- API Functions ---

export async function listMessages(options: {
  query?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
}) {
  const res = await client().users.messages.list({
    userId: "me",
    q: options.query,
    maxResults: options.maxResults ?? 20,
    pageToken: options.pageToken,
    labelIds: options.labelIds,
  });

  const messages = res.data.messages ?? [];
  const summaries = await Promise.all(
    messages.map(async (msg) => {
      const detail = await client().users.messages.get({
        userId: "me",
        id: msg.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      return {
        id: msg.id,
        threadId: msg.threadId,
        snippet: detail.data.snippet,
        subject: getHeader(detail.data.payload?.headers, "Subject"),
        from: getHeader(detail.data.payload?.headers, "From"),
        date: getHeader(detail.data.payload?.headers, "Date"),
        labelIds: detail.data.labelIds,
      };
    })
  );

  return {
    messages: summaries,
    nextPageToken: res.data.nextPageToken ?? null,
    resultSizeEstimate: res.data.resultSizeEstimate,
  };
}

export async function getMessage(messageId: string) {
  const res = await client().users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = res.data.payload?.headers;
  return {
    id: res.data.id,
    threadId: res.data.threadId,
    subject: getHeader(headers, "Subject"),
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    date: getHeader(headers, "Date"),
    body: extractBody(res.data.payload),
    labelIds: res.data.labelIds,
    attachments: extractAttachments(res.data.payload),
  };
}

export async function listLabels() {
  const res = await client().users.labels.list({ userId: "me" });
  return (res.data.labels ?? []).map((label) => ({
    id: label.id,
    name: label.name,
    type: label.type,
  }));
}

function buildRawMessage(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
  threadSubject?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${options.threadSubject ?? options.subject}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
    lines.push(`References: ${options.references ?? options.inReplyTo}`);
  }
  lines.push("");
  lines.push(options.body);

  return encodeBase64Url(lines.join("\r\n"));
}

export async function sendMessage(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}) {
  const raw = buildRawMessage(options);
  const res = await client().users.messages.send({
    userId: "me",
    requestBody: { raw },
  });

  return { id: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds };
}

export async function createDraft(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}) {
  const raw = buildRawMessage(options);
  const res = await client().users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw },
    },
  });

  return { id: res.data.id, messageId: res.data.message?.id };
}

export async function replyToMessage(messageId: string, body: string) {
  // Get the original message to extract threading headers
  const original = await client().users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Message-ID", "References"],
  });

  const headers = original.data.payload?.headers;
  const originalMessageId = getHeader(headers, "Message-ID");
  const references = getHeader(headers, "References");
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");

  const raw = buildRawMessage({
    to: from,
    subject: subject,
    body,
    inReplyTo: originalMessageId,
    references: references ? `${references} ${originalMessageId}` : originalMessageId,
    threadSubject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
  });

  const res = await client().users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: original.data.threadId!,
    },
  });

  return { id: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds };
}
