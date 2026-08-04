/**
 * claude-cli.ts — Sends messages to Claude by spawning the Claude Code CLI as a
 * subprocess, the same way Claudian does it under the hood.
 *
 * Why: Anthropic's API rejects (HTTP 429) direct `/v1/messages` calls made with a
 * Claude.ai OAuth bearer token — that token type is only accepted when the request
 * carries the Claude Code CLI's own request fingerprint. The CLI binary is the only
 * thing that can legitimately make the call.
 *
 * We don't do our own OAuth login. We just spawn `claude` with the environment
 * inherited as-is (same as Claudian) and let the CLI resolve its own stored
 * credentials — exactly what happens when you type `claude` in a terminal. The only
 * prerequisite is that the CLI is installed and already logged in (`claude login`,
 * once, outside this plugin). We talk to it over stdin/stdout using
 * `--input-format/--output-format stream-json`, one cold-start process per message.
 *
 * Tools (Read, Skill, etc.) are left at the CLI's own defaults, scoped to the vault
 * directory as cwd. Tool activity streams back as structured content blocks
 * (content_block_start/delta/stop with type "tool_use", then a top-level "user"
 * message carrying the tool_result) rather than as plain text — we parse those into
 * onToolEvent callbacks instead of letting the model's raw tool-call syntax leak
 * into the chat as text, which is what happens if tools are unavailable but the
 * model still tries to reach for one.
 *
 * Two permission modes (options.yolo), mirroring Claudian's own toggle:
 *  - yolo: true  → --permission-mode bypassPermissions — every tool runs instantly,
 *    no confirmation, same as Claudian's default cold-start behavior.
 *  - yolo: false → --permission-prompt-tool stdio — the CLI sends a control_request
 *    (subtype "can_use_tool") on stdout and blocks until we write back a matching
 *    control_response on stdin. We bridge that through options.onPermissionRequest
 *    so the UI can show an actual approve/deny prompt. With no bridge wired, we
 *    default to deny — never silently allow when we can't ask.
 */

import type { ChunkCallback, PermissionRequest, ProviderImage, ProviderMessage, ToolCallEvent, UsageInfo } from './ai-providers';

type ChatMsg = ProviderMessage;

// eslint-disable-next-line @typescript-eslint/no-require-imports
function requireNode<T>(mod: string): T {
  return require(mod) as T;
}

// ─── Locate the CLI on this machine ───────────────────────────────────────────

let cachedCliPath: string | null | undefined;

function findClaudeCliPath(): string | null {
  if (cachedCliPath !== undefined) return cachedCliPath;

  const cp   = requireNode<typeof import('child_process')>('child_process');
  const fs   = requireNode<typeof import('fs')>('fs');
  const path = requireNode<typeof import('path')>('path');

  const isWin = process.platform === 'win32';

  try {
    const out   = cp.execSync(isWin ? 'where claude' : 'which claude', { encoding: 'utf8', windowsHide: true });
    const first = out.split(/\r?\n/).map(l => l.trim()).find(l => l.length > 0);
    if (first && fs.existsSync(first)) return (cachedCliPath = first);
  } catch { /* not on PATH — fall through to well-known install locations */ }

  if (isWin) {
    const candidates: string[] = [];
    if (process.env.APPDATA) {
      candidates.push(
        path.join(process.env.APPDATA, 'npm', 'claude.cmd'),
        path.join(process.env.APPDATA, 'npm', 'claude.exe'),
        path.join(process.env.APPDATA, 'npm', 'claude'),
      );
    }
    const programFiles    = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    for (const base of [programFiles, programFilesX86]) {
      candidates.push(path.join(base, 'nodejs', 'node_global', 'claude.cmd'));
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) return (cachedCliPath = c);
    }
  }

  return (cachedCliPath = null);
}

export function isClaudeCliAvailable(): boolean {
  return findClaudeCliPath() !== null;
}

// ─── Status check (read-only) ───────────────────────────────────────────────────
// Never writes to ~/.claude/.credentials.json — only checks whether it looks like
// the CLI has an active login, purely for the settings UI's status badge.

export interface CliStatus { installed: boolean; authenticated: boolean; }

export async function checkCliStatus(): Promise<CliStatus> {
  const cliPath = findClaudeCliPath();
  if (!cliPath) return { installed: false, authenticated: false };

  try {
    const fs   = requireNode<typeof import('fs/promises')>('fs/promises');
    const path = requireNode<typeof import('path')>('path');
    const os   = requireNode<typeof import('os')>('os');

    const raw  = await fs.readFile(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = (data?.claudeAiOauth ?? data?.oauth) as Record<string, unknown> | undefined;
    return { installed: true, authenticated: Boolean(oauth?.accessToken) };
  } catch {
    return { installed: true, authenticated: false };
  }
}

// ─── Windows .cmd shim handling ────────────────────────────────────────────────
// npm global installs put a `claude.cmd` shim on Windows; Node can't exec that
// directly, so route it through cmd.exe (mirrors Claudian's own handling).

function quoteWindowsArg(v: string): string {
  if (v === '') return '""';
  return /[\s"&|<>^]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

function resolveSpawnSpec(command: string, args: string[]): { command: string; args: string[]; verbatim?: boolean } {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args };
  }
  const shellLine = [command, ...args].map(quoteWindowsArg).join(' ');
  return {
    command:  process.env.ComSpec || 'cmd.exe',
    args:     ['/d', '/s', '/c', `"${shellLine}"`],
    verbatim: true,
  };
}

// ─── History flattening ─────────────────────────────────────────────────────────
// Cold-start each call (no --resume/session tracking) — fold prior turns into the
// prompt text as a transcript, same technique Claudian uses for its own
// history-rebuild path.

function buildPrompt(messages: ChatMsg[]): string {
  if (messages.length === 0) return '';
  if (messages.length === 1) return messages[0].content;

  const history = messages.slice(0, -1);
  const latest  = messages[messages.length - 1];
  const transcript = history
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n\n');

  return `Here is the conversation so far for context:\n\n${transcript}\n\n---\n\n${latest.content}`;
}

// Images only ever come from the newest message. Mirrors Claudian's
// ClaudeUserMessageFactory: images first, text block last.
function buildContentBlocks(text: string, images: ProviderImage[]): Record<string, unknown>[] {
  return [
    ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    ...(text.trim() ? [{ type: 'text', text }] : []),
  ];
}

function lastMessageImages(messages: ChatMsg[]): ProviderImage[] {
  return messages[messages.length - 1]?.images ?? [];
}

// ─── Effort → --effort flag ─────────────────────────────────────────────────────
// Mirrors provider-config.ts's Claude effortOptions ids (low/medium/high/ultra),
// keyed by the token counts effortToTokens() derives them from.

const EFFORT_BY_TOKENS: Record<number, string> = { 1024: 'low', 4096: 'medium', 8192: 'high', 16384: 'ultra' };

// ─── Send ────────────────────────────────────────────────────────────────────────
// With a resumeSessionId, the CLI already remembers the whole conversation on
// disk (under ~/.claude/projects/...) — we send only the newest turn, which is
// what actually stops every message from re-paying token cost for the full
// history. Without one (first message in a conversation, or a stale/cross-machine
// session that failed to resume) we fall back to folding prior turns into the
// prompt as a transcript.

export interface CliSendOptions {
  cwd?:                    string;
  resumeSessionId?:        string;
  onSessionId?:            (id: string) => void;
  onToolEvent?:            (event: ToolCallEvent) => void;
  yolo?:                   boolean;
  onPermissionRequest?:    (req: PermissionRequest) => Promise<boolean>;
  additionalDirectories?:  string[];
  // The CLI's own "result" event already carries real token counts AND a
  // dollar cost computed at Anthropic's standard metered API pricing —
  // useful for cost-modeling even on a subscription plan where nothing is
  // actually billed per-token. It was being received and silently dropped
  // (the result handler below only ever checked msg.is_error) until now.
  onUsage?:                (usage: UsageInfo) => void;
}

export async function sendMessageViaCli(
  messages: ChatMsg[],
  model: string,
  maxTokens: number,
  onChunk: ChunkCallback,
  options: CliSendOptions = {},
): Promise<void> {
  try {
    await runClaudeProcess(messages, model, maxTokens, onChunk, options);
  } catch (err) {
    if (!options.resumeSessionId) throw err;
    // The stored session couldn't be resumed — most likely stale, pruned by the
    // CLI, or from a different machine (session files live under the user's home
    // directory, not the vault, so they don't follow a synced vault). Forget it
    // and retry once as a fresh cold-start with the full history folded in, so
    // the user's message doesn't just fail.
    options.onSessionId?.('');
    await runClaudeProcess(messages, model, maxTokens, onChunk, { ...options, resumeSessionId: undefined });
  }
}

async function runClaudeProcess(
  messages: ChatMsg[],
  model: string,
  maxTokens: number,
  onChunk: ChunkCallback,
  options: CliSendOptions,
): Promise<void> {
  const { cwd, resumeSessionId, onSessionId, onToolEvent, yolo, onPermissionRequest, additionalDirectories, onUsage } = options;

  const cliPath = findClaudeCliPath();
  if (!cliPath) {
    throw new Error(
      'Claude Code CLI not found on this machine. Install it from claude.com/code, then try again.',
    );
  }

  const cp = requireNode<typeof import('child_process')>('child_process');
  const os = requireNode<typeof import('os')>('os');

  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', model,
    ...(yolo
      ? ['--permission-mode', 'bypassPermissions', '--allow-dangerously-skip-permissions']
      : ['--permission-prompt-tool', 'stdio']),
  ];
  const effort = EFFORT_BY_TOKENS[maxTokens];
  if (effort) args.push('--effort', effort);
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  for (const dir of additionalDirectories ?? []) args.push('--add-dir', dir);

  const spec = resolveSpawnSpec(cliPath, args);

  return new Promise<void>((resolve, reject) => {
    const child = cp.spawn(spec.command, spec.args, {
      cwd: cwd || os.homedir(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(spec.verbatim ? { windowsVerbatimArguments: true } : {}),
    });

    let stderr       = '';
    let settled       = false;
    let streamedText  = false;

    // Tracks tool_use blocks as they stream in (by content_block index, to
    // accumulate the input_json_delta pieces) and by id (to look the name back up
    // once the matching tool_result arrives as a separate top-level message).
    const pendingByIndex = new Map<number, { id: string; name: string; json: string }>();
    const nameById       = new Map<string, string>();

    const finish = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    let buf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: Record<string, any>;
        try { msg = JSON.parse(trimmed); } catch { continue; }

        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          onSessionId?.(msg.session_id);
        } else if (msg.type === 'stream_event' && msg.event) {
          const ev = msg.event;
          if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
            const id = ev.content_block.id, name = ev.content_block.name;
            pendingByIndex.set(ev.index, { id, name, json: '' });
            nameById.set(id, name);
            onToolEvent?.({ id, name, status: 'running' });
          } else if (ev.type === 'content_block_delta') {
            if (ev.delta?.type === 'text_delta' && ev.delta.text) {
              streamedText = true;
              onChunk(ev.delta.text, false);
            }
            if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) {
              onChunk(ev.delta.thinking, true);
            }
            if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') {
              const pending = pendingByIndex.get(ev.index);
              if (pending) pending.json += ev.delta.partial_json;
            }
          } else if (ev.type === 'content_block_stop') {
            const pending = pendingByIndex.get(ev.index);
            if (pending) {
              let input: unknown;
              try { input = pending.json ? JSON.parse(pending.json) : undefined; } catch { input = pending.json; }
              onToolEvent?.({ id: pending.id, name: pending.name, status: 'running', input });
              pendingByIndex.delete(ev.index);
            }
          }
        } else if (msg.type === 'assistant' && !streamedText) {
          // Fallback if partial-message streaming wasn't emitted for this turn.
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            const text = content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
            if (text) onChunk(text, false);
          }
        } else if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
          // Tool results come back as a synthetic "user" turn the CLI generates
          // after actually running the tool locally.
          for (const block of msg.message.content) {
            if (block?.type === 'tool_result' && block.tool_use_id) {
              const resultText = Array.isArray(block.content)
                ? block.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
                : (typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
              onToolEvent?.({
                id:     block.tool_use_id,
                name:   nameById.get(block.tool_use_id) ?? 'tool',
                status: block.is_error ? 'error' : 'done',
                result: resultText,
              });
            }
          }
        } else if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
          const req       = msg.request;
          const toolUseId = req.tool_use_id as string;
          const toolName  = req.tool_name as string;
          const input     = req.input;
          onToolEvent?.({ id: toolUseId, name: toolName, status: 'needs-approval', input });

          void (async () => {
            // No bridge wired = can't ask = deny. Never silently allow.
            const allowed = onPermissionRequest ? await onPermissionRequest({ id: toolUseId, toolName, input }) : false;
            const response = allowed
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'User denied this action.', interrupt: false };
            const controlResponse = {
              type: 'control_response',
              response: { subtype: 'success', request_id: msg.request_id, response: { ...response, toolUseID: toolUseId } },
            };
            child.stdin?.write(JSON.stringify(controlResponse) + '\n');
          })();
        } else if (msg.type === 'result') {
          // The CLI's own "this turn is fully done" signal — every tool call
          // (and its control_request/control_response round-trip, if any) has
          // already resolved by the time this arrives. Ending stdin here,
          // rather than never or immediately after the first write, is what
          // actually lets the process exit cleanly: it turns out the CLI
          // keeps its main loop parked waiting for either another stdin line
          // or EOF, so with nothing to close stdin (the fix for the earlier
          // "Stream closed" bug went too far and just never closed it), a
          // successful turn with no pending permission prompt would finish
          // generating its response and then hang forever instead of exiting
          // — child.on('exit') never fires, the promise never settles, and
          // the composer's "streaming" flag stays stuck true (send disabled).
          child.stdin?.end();
          // usage/total_cost_usd are top-level fields on this same "result"
          // event (not nested under a sub-message) — present on both success
          // and error results, so this reads regardless of is_error below.
          if (msg.usage) {
            onUsage?.({
              inputTokens:               msg.usage.input_tokens ?? 0,
              outputTokens:              msg.usage.output_tokens ?? 0,
              cacheCreationInputTokens:  msg.usage.cache_creation_input_tokens,
              cacheReadInputTokens:      msg.usage.cache_read_input_tokens,
              costUsd:                   typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : undefined,
            });
          }
          if (msg.is_error) {
            finish(() => { child.kill(); reject(new Error(msg.result || msg.error || 'Claude CLI returned an error')); });
          }
        }
      }
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(() => reject(new Error(`Failed to launch Claude CLI: ${err.message}`)));
    });

    child.on('exit', (code) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Claude CLI exited with code ${code}`));
      });
    });

    const images = lastMessageImages(messages);
    const text   = resumeSessionId ? (messages[messages.length - 1]?.content ?? '') : buildPrompt(messages);

    const stdinLine = JSON.stringify({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: buildContentBlocks(text, images) },
      parent_tool_use_id: null,
    });
    child.stdin?.write(stdinLine + '\n');
    // Deliberately NOT calling child.stdin.end() here. In Safe mode
    // (yolo: false) the CLI can send a control_request ("can_use_tool")
    // asking for permission at any point *after* this initial message —
    // see the can_use_tool handler above, which writes a control_response
    // back on this same stdin. Ending stdin right after the first write
    // closed that pipe before any tool actually needed approval, so the
    // very first permission round-trip (WebFetch, Bash, etc.) failed with
    // "Stream closed" — the CLI had nowhere left to receive the response.
    // Node closes this pipe on its own once the child process exits, so
    // there's nothing to clean up here.
  });
}
