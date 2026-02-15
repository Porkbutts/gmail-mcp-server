/**
 * OAuth 2.0 helper script to obtain a Gmail refresh token.
 *
 * Prerequisites:
 *   1. Create OAuth 2.0 credentials (Desktop app) in Google Cloud Console
 *   2. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars
 *
 * Usage:
 *   npx tsx scripts/get-refresh-token.ts
 *
 * This will:
 *   1. Print an authorization URL — open it in your browser
 *   2. After granting access, Google redirects to localhost with a code
 *   3. The script exchanges the code for a refresh token and prints it
 */

import http from "node:http";
import { google } from "googleapis";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("Error: Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables first.");
  console.error("");
  console.error("  export GMAIL_CLIENT_ID=your-client-id");
  console.error("  export GMAIL_CLIENT_SECRET=your-client-secret");
  process.exit(1);
}

const PORT = 3847;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("1. Open this URL in your browser:\n");
console.log(`   ${authUrl}\n`);
console.log("2. Sign in and grant access. You'll be redirected back here automatically.\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h1>No authorization code received</h1>");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>Success!</h1><p>You can close this tab. Check your terminal for the refresh token.</p>");

    console.log("Success! Here's your refresh token:\n");
    console.log(`   GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("Add all three variables to your MCP server config or shell profile.");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h1>Token exchange failed</h1><pre>${err}</pre>`);
    console.error("Token exchange failed:", err);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`Waiting for redirect on http://localhost:${PORT} ...\n`);
});
