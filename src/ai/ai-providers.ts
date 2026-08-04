/**
 * ai-providers.ts — API call logic for each provider.
 * UI/brand config lives in provider-config.ts; this handles the network layer only.
 */

import { sendMessageViaCli } from './claude-cli';

export type ProviderId = 'claude' | 'gemini' | 'openai' | 'local';

export interface AIModel { id: string; name: string; }

/**
 * onChunk callback. `isThinking` = true for Claude extended-thinking delta blocks.
 * Everything else is treated as regular text.
 */
export type ChunkCallback = (text: string, isThinking?: boolean) => void;

export interface ProviderImage { mediaType: string; data: string; name?: string; }

export interface ProviderMessage {
  role:    string;
  content: string;
  images?: ProviderImage[]; // Claude only, for now
}

export interface ToolCallEvent {
  id:      string;
  name:    string;
  status:  'needs-approval' | 'running' | 'done' | 'error';
  input?:  unknown;
  result?: string;
}

export interface PermissionRequest {
  id:       string;
  toolName: string;
  input:    unknown;
}

// costUsd is only ever populated when the provider hands us a real computed
// figure (CLI mode's own "result" event) — for API-key mode we compute an
// estimate from token counts via CLAUDE_PRICING below rather than trusting
// a number nobody actually gave us, but it lands in the same field either
// way so the UI doesn't need to know or care which path it came from.
export interface UsageInfo {
  inputTokens:               number;
  outputTokens:              number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?:     number;
  costUsd?:                  number;
  costIsEstimate?:           boolean; // true when we computed costUsd ourselves (API-key mode) rather than the provider handing us an authoritative figure (CLI mode's total_cost_usd)
}

// Best-effort $/million-token rates for estimating API-key-mode cost from
// raw token counts — Anthropic doesn't return a cost figure directly like
// the CLI does, only usage. Matched by substring against the model id
// rather than an exact map, since ids drift (dated snapshots, aliases) more
// often than the underlying price tiers do. **Update these if Anthropic
// changes pricing** — this is a manual table, not fetched from anywhere.
const CLAUDE_PRICING: { match: string; inPerM: number; outPerM: number }[] = [
  { match: 'opus',   inPerM: 15,   outPerM: 75 },
  { match: 'sonnet', inPerM: 3,    outPerM: 15 },
  { match: 'haiku',  inPerM: 0.8,  outPerM: 4 },
];

function estimateClaudeCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const tier = CLAUDE_PRICING.find(p => model.toLowerCase().includes(p.match));
  if (!tier) return undefined;
  return (inputTokens / 1_000_000) * tier.inPerM + (outputTokens / 1_000_000) * tier.outPerM;
}

export interface SendMessageExtras {
  localBaseUrl?:        string;                            // 'local' provider only
  vaultPath?:           string;                             // 'claude' CLI mode only (subprocess cwd)
  resumeSessionId?:     string;                             // 'claude' CLI mode only — resume instead of flattening history
  onSessionId?:         (id: string) => void;               // 'claude' CLI mode only — reports the session id to persist ('' = forget it)
  onToolEvent?:         (event: ToolCallEvent) => void;      // 'claude' CLI mode only — Skill/Read/etc. tool activity
  yolo?:                boolean;                            // 'claude' CLI mode only — bypass tool permission prompts entirely
  onPermissionRequest?: (req: PermissionRequest) => Promise<boolean>; // 'claude' CLI mode only, when !yolo
  additionalDirectories?: string[];                          // 'claude' CLI mode only — --add-dir, absolute paths
  onUsage?:             (usage: UsageInfo) => void;          // 'claude' only (both CLI and API-key modes)
}

export interface ProviderAPI {
  id: ProviderId;
  sendMessage: (
    messages:   ProviderMessage[],
    model:      string,
    maxTokens:  number,
    credential: string,   // API key, or "" for local (uses localBaseUrl) / Claude CLI mode
    onChunk:    ChunkCallback,
    extras?:    SendMessageExtras,
  ) => Promise<void>;
}

export const OUTPUT_TOKENS: Record<'low' | 'med' | 'high' | 'ultra', number> = {
  low: 1024, med: 4096, high: 8192, ultra: 16384,
};

// Map effort/output level IDs to max_tokens
export function effortToTokens(effort: string | null): number {
  if (!effort) return 4096;
  const map: Record<string, number> = { none: 1024, low: 1024, minimal: 1024, medium: 4096, high: 8192, ultra: 16384, xhigh: 16384 };
  return map[effort] ?? 4096;
}

// ─── SSE reader ───────────────────────────────────────────────────────────────

async function readSSE(
  response: Response,
  parseLine: (line: string) => { text: string; isThinking?: boolean } | null,
  onChunk: ChunkCallback,
): Promise<void> {
  const reader  = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const result = parseLine(line.trim());
      if (result?.text) onChunk(result.text, result.isThinking);
    }
  }
}

// ─── Claude: direct API-key path (pay-per-use) ─────────────────────────────────
// A real Anthropic API key was never affected by the OAuth/429 issue — only
// Claude.ai OAuth bearer tokens are rejected direct. This path supports full
// multi-turn image history since it sends the whole messages array each call.

function toAnthropicContent(m: ProviderMessage): string | Record<string, unknown>[] {
  if (!m.images?.length) return m.content;
  return [
    ...m.images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    ...(m.content.trim() ? [{ type: 'text', text: m.content }] : []),
  ];
}

async function sendMessageViaApiKey(
  messages: ProviderMessage[],
  model: string,
  maxTokens: number,
  apiKey: string,
  onChunk: ChunkCallback,
  onUsage?: (usage: UsageInfo) => void,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const https = require('https') as typeof import('https');

  const body = JSON.stringify({
    model,
    messages:   messages.map(m => ({ role: m.role, content: toAnthropicContent(m) })),
    max_tokens: maxTokens,
    stream:     true,
  });

  const headers: Record<string, string | number> = {
    'content-type':      'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key':         apiKey,
    'content-length':    Buffer.byteLength(body, 'utf8'),
  };

  return new Promise<void>((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers },
      (res) => {
        if (res.statusCode !== 200) {
          let raw = '';
          res.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
          res.on('end', () => {
            try {
              const e = JSON.parse(raw) as { error?: { message?: string } };
              reject(new Error(`HTTP ${res.statusCode}: ${e.error?.message ?? raw}`));
            } catch { reject(new Error(`HTTP ${res.statusCode}: ${raw}`)); }
          });
          return;
        }

        // Anthropic's own streaming protocol reports usage in two pieces —
        // input tokens (+ cache fields) up front on message_start, output
        // tokens only once generation is actually done on message_delta —
        // never both at once, so accumulate and fire onUsage from whichever
        // event lands last.
        let inputTokens = 0, cacheCreationInputTokens: number | undefined, cacheReadInputTokens: number | undefined;
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith('data:')) continue;
            try {
              const j = JSON.parse(t.slice(5)) as {
                type?: string;
                delta?: { type?: string; text?: string; thinking?: string };
                message?: { usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } };
                usage?: { output_tokens?: number };
              };
              if (j.type === 'content_block_delta') {
                if (j.delta?.type === 'text_delta'     && j.delta.text)     onChunk(j.delta.text, false);
                if (j.delta?.type === 'thinking_delta' && j.delta.thinking) onChunk(j.delta.thinking, true);
              } else if (j.type === 'message_start' && j.message?.usage) {
                inputTokens              = j.message.usage.input_tokens ?? 0;
                cacheCreationInputTokens = j.message.usage.cache_creation_input_tokens;
                cacheReadInputTokens     = j.message.usage.cache_read_input_tokens;
              } else if (j.type === 'message_delta' && j.usage?.output_tokens != null) {
                const outputTokens = j.usage.output_tokens;
                onUsage?.({
                  inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens,
                  costUsd: estimateClaudeCostUsd(model, inputTokens, outputTokens),
                  costIsEstimate: true,
                });
              }
            } catch { /* skip malformed line */ }
          }
        });
        res.on('end', resolve);
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Provider implementations ─────────────────────────────────────────────────

export const PROVIDER_API: Record<ProviderId, ProviderAPI> = {

  claude: {
    id: 'claude',
    async sendMessage(messages, model, maxTokens, credential, onChunk, extras) {
      if (credential) {
        // API-key mode (pay-per-use) — direct HTTPS, full image/history fidelity.
        await sendMessageViaApiKey(messages, model, maxTokens, credential, onChunk, extras?.onUsage);
        return;
      }
      // CLI mode (subscription) — spawn the Claude Code CLI and let it
      // authenticate itself from its own stored login. See claude-cli.ts.
      await sendMessageViaCli(messages, model, maxTokens, onChunk, {
        cwd: extras?.vaultPath,
        resumeSessionId: extras?.resumeSessionId,
        onSessionId: extras?.onSessionId,
        onToolEvent: extras?.onToolEvent,
        yolo: extras?.yolo,
        onPermissionRequest: extras?.onPermissionRequest,
        additionalDirectories: extras?.additionalDirectories,
        onUsage: extras?.onUsage,
      });
    },
  },

  gemini: {
    id: 'gemini',
    async sendMessage(messages, model, maxTokens, apiKey, onChunk) {
      const contents = messages.map(m => ({
        role:  m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens } }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }
      await readSSE(res, (line) => {
        if (!line.startsWith('data:')) return null;
        try {
          const j = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          return text ? { text } : null;
        } catch { return null; }
      }, onChunk);
    },
  },

  openai: {
    id: 'openai',
    async sendMessage(messages, model, maxTokens, apiKey, onChunk) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }
      await readSSE(res, (line) => {
        if (!line.startsWith('data:')) return null;
        const d = line.slice(5).trim();
        if (d === '[DONE]') return null;
        try {
          const j = JSON.parse(d) as { choices?: { delta?: { content?: string } }[] };
          const text = j.choices?.[0]?.delta?.content ?? '';
          return text ? { text } : null;
        } catch { return null; }
      }, onChunk);
    },
  },

  local: {
    id: 'local',
    async sendMessage(messages, model, maxTokens, credential, onChunk, extras) {
      const localBaseUrl = extras?.localBaseUrl ?? 'http://localhost:11434';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (credential) headers['Authorization'] = `Bearer ${credential}`;

      const res = await fetch(`${localBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `HTTP ${res.status} — is the server running?`);
      }
      await readSSE(res, (line) => {
        if (!line.startsWith('data:')) return null;
        const d = line.slice(5).trim();
        if (d === '[DONE]') return null;
        try {
          const j = JSON.parse(d) as { choices?: { delta?: { content?: string } }[] };
          const text = j.choices?.[0]?.delta?.content ?? '';
          return text ? { text } : null;
        } catch { return null; }
      }, onChunk);
    },
  },
};
