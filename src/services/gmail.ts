import { gmail_v1 } from "googleapis";
import { getGmailClient } from "../auth.js";
import * as fs from "fs";
import * as path from "path";

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
): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
        attachmentId: part.body.attachmentId,
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

export async function getAttachment(options: {
  messageId: string;
  attachmentId: string;
  filename: string;
  savePath?: string;
}) {
  const { messageId, attachmentId, filename } = options;
  const outputPath = options.savePath ?? path.join("/tmp", filename);

  const res = await client().users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  const data = res.data.data;
  if (!data) throw new Error("Attachment data is empty");

  const buffer = Buffer.from(data, "base64url");
  fs.writeFileSync(outputPath, buffer);

  return {
    filePath: outputPath,
    filename,
    size: buffer.length,
  };
}

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
  attachments?: string[];
}): string {
  const hasAttachments = options.attachments && options.attachments.length > 0;

  if (!hasAttachments) {
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

  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];
  lines.push(`To: ${options.to}`);
  if (options.cc) lines.push(`Cc: ${options.cc}`);
  if (options.bcc) lines.push(`Bcc: ${options.bcc}`);
  lines.push(`Subject: ${options.threadSubject ?? options.subject}`);
  lines.push("MIME-Version: 1.0");
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: ${options.inReplyTo}`);
    lines.push(`References: ${options.references ?? options.inReplyTo}`);
  }
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");

  // Text body part
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(options.body);
  lines.push("");

  // Attachment parts
  for (const filePath of options.attachments!) {
    const filename = path.basename(filePath);
    const content = fs.readFileSync(filePath);
    const encoded = content.toString("base64");
    const mimeType = guessMimeType(filename);

    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${mimeType}; name="${filename}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${filename}"`);
    lines.push("");
    // Split base64 into 76-char lines per MIME spec
    for (let i = 0; i < encoded.length; i += 76) {
      lines.push(encoded.slice(i, i + 76));
    }
    lines.push("");
  }

  lines.push(`--${boundary}--`);
  return encodeBase64Url(lines.join("\r\n"));
}

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".html": "text/html",
    ".json": "application/json",
    ".xml": "application/xml",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
  };
  return types[ext] ?? "application/octet-stream";
}

export async function sendMessage(options: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  attachments?: string[];
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
  attachments?: string[];
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

export async function replyToMessage(messageId: string, body: string, attachments?: string[]) {
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
    attachments,
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
