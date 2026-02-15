# Gmail MCP Server

An MCP (Model Context Protocol) server for the Gmail API. This server allows AI assistants to read, search, send, and draft emails using OAuth 2.0 authentication.

## Features

- **Search emails** using full Gmail query syntax (e.g. `from:boss is:unread`)
- **Read full messages** with decoded body text and attachment metadata
- **Send emails** with to, cc, bcc support
- **Create drafts** for review before sending
- **Reply to messages** with proper threading (In-Reply-To/References headers)
- **List labels** for filtering and organization

## Prerequisites

- Node.js 18+
- Google Cloud project with Gmail API enabled
- OAuth 2.0 credentials (Desktop app type)
- Refresh token with appropriate Gmail scopes

## Installation

```bash
npm install
npm run build
```

## Configuration

Set your OAuth 2.0 credentials via environment variables:

```bash
export GMAIL_CLIENT_ID=your-client-id
export GMAIL_CLIENT_SECRET=your-client-secret
export GMAIL_REFRESH_TOKEN=your-refresh-token
```

## Usage with Claude Code

```bash
claude mcp add-json gmail '{
  "command": "node",
  "args": ["/path/to/gmail-mcp-server/dist/index.js"],
  "env": {
    "GMAIL_CLIENT_ID": "your-client-id",
    "GMAIL_CLIENT_SECRET": "your-client-secret",
    "GMAIL_REFRESH_TOKEN": "your-refresh-token"
  }
}'
```

## Available Tools

### gmail_list_messages

List or search Gmail messages. Supports full Gmail search query syntax.

**Parameters:**
- `query`: Gmail search query (e.g. `is:unread`, `from:alice subject:meeting`)
- `maxResults`: Number of messages to return (1-100, default: 20)
- `pageToken`: Page token for pagination (from previous response's `nextPageToken`)
- `labelIds`: Filter by label IDs (e.g. `["INBOX", "UNREAD"]`)

### gmail_get_message

Get the full content of an email by ID. Returns decoded body text (prefers plain text, falls back to stripped HTML).

**Parameters:**
- `messageId` (required): The message ID (from `gmail_list_messages`)

### gmail_list_labels

List all Gmail labels (INBOX, SENT, custom labels). Useful for discovering label IDs to filter messages.

### gmail_send_message

Send an email via Gmail.

**Parameters:**
- `to` (required): Recipient email address(es), comma-separated for multiple
- `subject` (required): Email subject line
- `body` (required): Email body text (plain text)
- `cc`: CC recipients, comma-separated
- `bcc`: BCC recipients, comma-separated

### gmail_create_draft

Create a draft email in Gmail. The draft can be reviewed and sent from the Gmail UI.

**Parameters:**
- `to` (required): Recipient email address(es), comma-separated for multiple
- `subject` (required): Email subject line
- `body` (required): Email body text (plain text)
- `cc`: CC recipients, comma-separated
- `bcc`: BCC recipients, comma-separated

### gmail_reply_to_message

Reply to an existing email. Preserves threading so the reply appears in the same conversation.

**Parameters:**
- `messageId` (required): The message ID to reply to
- `body` (required): Reply body text (plain text)

## Setup Guide

### Step 1: Create a Google Cloud project

1. Go to https://console.cloud.google.com and create a new project (or select an existing one)
2. Navigate to **APIs & Services > Library**
3. Search for **Gmail API** and click **Enable**

### Step 2: Create OAuth 2.0 credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. If prompted, configure the **OAuth consent screen** first:
   - Choose **External** user type (or Internal if using Google Workspace)
   - Fill in the required app name and email fields
   - Add scopes: `gmail.readonly`, `gmail.send`, `gmail.modify`
   - Add your Google account as a **test user**
4. Back in Credentials, create an **OAuth client ID**:
   - Application type: **Desktop app**
   - Name: anything (e.g. "Gmail MCP Server")
5. Copy the **Client ID** and **Client Secret**

### Step 3: Get a refresh token

Set your client credentials and run the included helper script:

```bash
export GMAIL_CLIENT_ID=your-client-id
export GMAIL_CLIENT_SECRET=your-client-secret
npx tsx scripts/get-refresh-token.ts
```

This will:
1. Print an authorization URL — open it in your browser
2. Sign in with your Google account and grant access
3. Automatically capture the redirect and print your refresh token

### Step 4: Configure the MCP server

Add all three values to your Claude Code MCP config (see [Usage with Claude Code](#usage-with-claude-code) above).

## License

MIT
