/**
 * google-oauth.ts — OAuth 2.0 PKCE flow for Google Calendar
 *
 * Flow:
 *   1. Generate PKCE verifier + challenge
 *   2. Open browser with Google authorization URL
 *   3. Spin up a local HTTP server on a fixed port to catch the redirect
 *   4. Exchange the auth code for access + refresh tokens
 *   5. Store tokens via TokenStore (backed by plugin.saveData)
 *   6. Auto-refresh the access token before it expires on every API call
 *
 * No client secret is required — PKCE replaces it for Desktop app flows.
 */

import { requestUrl } from "obsidian";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoogleTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number; // epoch ms
}

/** Minimal interface the OAuth layer needs to persist tokens. */
export interface TokenStore {
  getTokens():                    Promise<GoogleTokens | null>;
  saveTokens(t: GoogleTokens):    Promise<void>;
  clearTokens():                  Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE   = "https://www.googleapis.com/auth/calendar";

// Port for the loopback redirect server.
// Chosen to avoid collision with YukiGasai plugin (42813).
export const REDIRECT_PORT = 42814;
export const REDIRECT_URI  = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generateVerifier(): string {
  const arr = new Uint8Array(32);
  window.crypto.getRandomValues(arr);
  return base64urlEncode(arr);
}

async function deriveChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(hash));
}

// ─── Build the authorization URL ─────────────────────────────────────────────

export async function buildAuthUrl(
  clientId: string,
): Promise<{ url: string; verifier: string; state: string }> {
  const verifier  = generateVerifier();
  const challenge = await deriveChallenge(verifier);
  const state     = generateVerifier().slice(0, 16); // CSRF token

  const params = new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          REDIRECT_URI,
    response_type:         "code",
    scope:                 CALENDAR_SCOPE,
    access_type:           "offline",
    // "consent" alone guarantees a refresh_token, but lets Google infer WHICH
    // account from browser session state — and with several accounts signed in
    // that inference is where the flow breaks (the `authuser=0`/`pli=1` params
    // Google adds are the tell). "select_account" forces an explicit picker
    // instead of guessing, which is both more reliable and clearer to anyone
    // who keeps a work and a personal account in one browser.
    prompt:                "select_account consent",
    code_challenge:        challenge,
    code_challenge_method: "S256",
    state,
  });

  return { url: `${GOOGLE_AUTH_URL}?${params}`, verifier, state };
}

// ─── Opening the consent page ────────────────────────────────────────────────

/**
 * Opens the authorization URL in the user's REAL browser.
 *
 * `window.open()` was doing this before, and inside Obsidian that is not
 * reliable: depending on how the call is made, Electron may satisfy it with an
 * in-app BrowserWindow rather than handing off to the system browser. That
 * distinction is fatal here, because **Google refuses to run OAuth inside
 * embedded browser frameworks** — it's an explicit anti-phishing policy, and
 * the rejection surfaces as a generic error page rather than anything that
 * names the real cause.
 *
 * `shell.openExternal` is Electron's unambiguous "hand this to the OS" call.
 * `electron` is already an esbuild external (see esbuild.config.mjs), so the
 * require resolves at runtime on desktop. On mobile — or anywhere the module
 * is absent — it falls back to the old behaviour rather than throwing, since a
 * possibly-embedded window still beats no window at all.
 */
function openInSystemBrowser(url: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require("electron") as { shell?: { openExternal(u: string): Promise<void> } };
    if (electron?.shell?.openExternal) {
      void electron.shell.openExternal(url);
      return;
    }
  } catch {
    /* not a desktop runtime — fall through */
  }
  window.open(url, "_blank");
}

// ─── Local callback server ────────────────────────────────────────────────────

/**
 * Starts a temporary HTTP server that listens for one request on REDIRECT_PORT,
 * extracts the `code` param from the callback URL, responds with a nice
 * "you can close this tab" page, then shuts down.
 *
 * Rejects if:
 *  - the callback contains an `error` param
 *  - the returned `state` doesn't match (CSRF protection)
 *  - no request arrives within 5 minutes
 */
export function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Node's `http` module is available in Obsidian's Electron runtime.
    // esbuild.config.mjs marks all builtins as external, so this require is fine.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require("http") as typeof import("http");

    const server = http.createServer((req, res) => {
      try {
        const url    = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
        const code   = url.searchParams.get("code");
        const state  = url.searchParams.get("state");
        const error  = url.searchParams.get("error");

        const html = (msg: string, ok: boolean) => `
          <!DOCTYPE html><html><body style="
            margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
            font-family:system-ui,sans-serif;background:#0d0d0d;color:#e0e0e0">
            <div style="text-align:center">
              <div style="font-size:48px;margin-bottom:16px">${ok ? "✅" : "❌"}</div>
              <h2 style="color:${ok ? "#7c6aff" : "#e67c73"};margin:0 0 8px">${msg}</h2>
              <p style="opacity:.6;margin:0">You can close this tab and return to Obsidian.</p>
            </div>
          </body></html>`;

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(html(`Google login failed: ${error}`, false));
          server.close();
          reject(new Error(`Google OAuth error: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(html("Invalid state — possible CSRF attack", false));
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(html("No authorization code received", false));
          server.close();
          reject(new Error("No authorization code in callback"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html("Connected to Google Calendar!", true));
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(REDIRECT_PORT, "127.0.0.1");

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(
          `Port ${REDIRECT_PORT} is already in use. ` +
          "Close other apps using it and try again."
        ));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Google login timed out. Please try again."));
    }, 5 * 60 * 1000);

    server.on("close", () => clearTimeout(timeout));
  });
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(
  code:         string,
  verifier:     string,
  clientId:     string,
  clientSecret: string,
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  REDIRECT_URI,
    client_id:     clientId,
    client_secret: clientSecret,
    code_verifier: verifier,
  });

  let resp;
  try {
    resp = await requestUrl({
      url:    GOOGLE_TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:   body.toString(),
      throw:  false, // don't throw on 4xx — we want to read the error body
    });
  } catch (netErr) {
    throw new Error(`Network error during token exchange: ${netErr}`);
  }

  const json = resp.json as Record<string, unknown>;

  if (resp.status !== 200 || !json["access_token"]) {
    const errCode = json["error"] ?? "unknown_error";
    const errDesc = json["error_description"] ?? JSON.stringify(json);
    throw new Error(`Google token exchange failed (${resp.status}): ${errCode} — ${errDesc}`);
  }

  if (!json["refresh_token"]) {
    throw new Error(
      "Google did not return a refresh token. " +
      "Go to myaccount.google.com/permissions, remove 'Obsidian Command Center', then try connecting again."
    );
  }

  return {
    accessToken:  json["access_token"] as string,
    refreshToken: json["refresh_token"] as string,
    expiresAt:    Date.now() + ((json["expires_in"] as number) ?? 3600) * 1000,
  };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshTokens(
  tokens:       GoogleTokens,
  clientId:     string,
  clientSecret  = "",
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id:     clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const resp = await requestUrl({
    url:    GOOGLE_TOKEN_URL,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:   body.toString(),
  });

  const json = resp.json;
  if (!json.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(json)}`);
  }

  return {
    // refresh_token is not re-issued on every refresh — keep the original
    refreshToken: tokens.refreshToken,
    accessToken:  json.access_token,
    expiresAt:    Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

// ─── Get a guaranteed-valid access token ─────────────────────────────────────

/**
 * Returns a valid access token, refreshing silently if it's within 2 min
 * of expiry. Call this before every API request — it's cheap when not refreshing.
 *
 * clientSecret MUST be supplied — Google Desktop App OAuth requires it on
 * every token refresh, not just the initial code exchange.
 */
export async function getValidToken(
  store:         TokenStore,
  clientId:      string,
  clientSecret?: string,
): Promise<string> {
  let tokens = await store.getTokens();
  if (!tokens) throw new Error("Not connected to Google. Use the Connect button.");

  const twoMinutes = 2 * 60 * 1000;
  if (Date.now() > tokens.expiresAt - twoMinutes) {
    tokens = await refreshTokens(tokens, clientId, clientSecret ?? "");
    await store.saveTokens(tokens);
  }

  return tokens.accessToken;
}

// ─── Full login flow ──────────────────────────────────────────────────────────

/**
 * Kicks off the full OAuth dance:
 *   build URL → start server → open browser → wait → exchange → save
 *
 * Resolves when tokens are stored. Rejects on any failure.
 */
export async function loginWithGoogle(
  store:        TokenStore,
  clientId:     string,
  clientSecret: string,
): Promise<void> {
  const { url, verifier, state } = await buildAuthUrl(clientId);

  // Start the callback server BEFORE opening the browser tab
  const codePromise = waitForCallback(state);

  openInSystemBrowser(url);

  const code   = await codePromise;
  const tokens = await exchangeCodeForTokens(code, verifier, clientId, clientSecret);
  await store.saveTokens(tokens);
}
