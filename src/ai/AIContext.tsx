/**
 * AIContext.tsx — Global AI assistant state, persisted via AIDataStore.
 */

import * as React from 'react';
import { PROVIDER_API, effortToTokens } from './ai-providers';
import type { ProviderId, ChunkCallback, PermissionRequest, ToolCallEvent, UsageInfo } from './ai-providers';
import { checkCliStatus } from './claude-cli';
import type { CliStatus } from './claude-cli';
import { PROVIDER_CFG } from './provider-config';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MsgSegment {
  type:   'thinking' | 'text' | 'table' | 'tool' | 'insight';
  text?:  string;
  cols?:  string[];
  rows?:  string[][];
}

export interface ImageAttachment {
  name:      string;
  mediaType: string;   // e.g. 'image/png'
  data:      string;   // base64, no data: prefix
}

export interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;     // accumulated streamed text
  thinking?: string;     // thinking block content (Claude extended thinking)
  files?:    string[];   // attached vault file paths (user messages)
  images?:   ImageAttachment[]; // attached images (user messages, Claude only for now)
  toolCalls?: ToolCallEvent[]; // Claude CLI mode only — Skill/Read/etc. tool activity
  usage?:    UsageInfo;  // Claude only (CLI and API-key) — real token counts + cost for this one turn
  timestamp: number;
}

export interface AIConversation {
  id:              string;
  title:           string;
  providerId:      ProviderId;
  modelId:         string;
  messages:        ChatMessage[];
  createdAt:       number;
  updatedAt:       number;
  cliSessionId?:   string;   // Claude CLI mode only — lets --resume carry the real conversation
  contextFolders?: string[]; // Claude CLI mode only — absolute paths given to Claude's own tools as --add-dir
}

export interface LocalConfig {
  baseUrl:   string;
  modelName: string;
  needsAuth: boolean;
  apiKey:    string;
}

export interface AISettings {
  activeProvider:  ProviderId;
  keys:            Partial<Record<ProviderId, string>>;  // API keys for gemini/openai/claude
  claudeAuthMode:  'cli' | 'apikey';                     // Claude only — 'cli' uses the Claude Code CLI (subscription)
  claudeYoloMode:  boolean;                              // Claude CLI mode only — bypass tool permission prompts entirely
  lockedContextFolders: string[];                        // absolute paths — auto-attached to every new conversation, any provider
  localConfig:     LocalConfig;
  models:          Partial<Record<ProviderId, string>>;  // per-provider selected model
  effort:          Partial<Record<ProviderId, string>>;  // per-provider effort level
  voiceEnabled:    boolean;
  showTokenCounter: boolean;
}

export interface SendMessageOpts {
  // Start a brand-new conversation for this message regardless of whatever's
  // currently active — see the comment at its use site in sendMessage() for
  // why this has to be a flag handled inside sendMessage itself rather than
  // the caller doing newConversation() then sendMessage().
  forceNewConversation?: boolean;
  // Use this provider's cheapest/quickest model (PROVIDER_CFG[pid].fastModel)
  // for this call, overriding the user's globally-selected model — for
  // bounded, mechanical tasks (a skill with explicit rules to follow) that
  // don't need the heavier default. No-op for providers without a fastModel
  // (currently just 'local' — see the field's comment in provider-config.ts).
  useFastModel?: boolean;
}

export interface AIStoredData {
  settings:      AISettings;
  conversations: AIConversation[];
  activeConvId:  string | null;
}

export interface AIDataStore {
  load: () => Promise<AIStoredData | null>;
  save: (data: AIStoredData) => Promise<void>;
}

// ─── Context interface ──────────────────────────────────────────────────────────

export interface AICtx {
  settings:         AISettings;
  conversations:    AIConversation[];
  activeConvId:     string | null;
  activeConv:       AIConversation | null;
  streaming:        boolean;
  error:            string | null;
  panelOpen:        boolean;
  setPanelOpen:     (open: boolean) => void;
  claudeCliStatus:  CliStatus | null;
  checkingClaudeCli: boolean;
  pendingApproval:  PermissionRequest | null;

  checkClaudeCli:   () => Promise<void>;
  respondToApproval: (allow: boolean) => void;

  addContextFolder:       (path: string) => void;
  removeContextFolder:    (path: string) => void;
  toggleLockContextFolder: (path: string) => void;

  newConversation:    ()                          => void;
  selectConversation: (id: string)                => void;
  deleteConversation: (id: string)                => void;
  sendMessage:        (text: string, files?: string[], images?: ImageAttachment[], opts?: SendMessageOpts) => Promise<void>;
  updateSettings:     (patch: Partial<AISettings>) => Promise<void>;
  parseSegments:      (content: string, thinking?: string) => MsgSegment[];
}

// ─── Segment parser ─────────────────────────────────────────────────────────────

function parseSegments(content: string, thinking?: string): MsgSegment[] {
  const segs: MsgSegment[] = [];

  if (thinking) {
    segs.push({ type: 'thinking', text: thinking });
  }

  // Split by markdown table blocks
  const tableRe = /(\|[^\n]+\|\n\|[-| :]+\|\n(?:\|[^\n]+\|\n?)*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(content)) !== null) {
    const before = content.slice(last, match.index).trim();
    if (before) segs.push({ type: 'text', text: before });

    const lines = match[1].trim().split('\n');
    const cols = lines[0].split('|').filter(c => c.trim()).map(c => c.trim());
    const rows = lines.slice(2)
      .filter(l => l.trim())
      .map(l => l.split('|').filter(c => c.trim()).map(c => c.trim()));
    segs.push({ type: 'table', cols, rows });

    last = match.index + match[0].length;
  }

  const rest = content.slice(last).trim();
  if (rest) segs.push({ type: 'text', text: rest });

  return segs.length > 0 ? segs : (content ? [{ type: 'text', text: content }] : []);
}

// ─── Context ────────────────────────────────────────────────────────────────────

const AIContext = React.createContext<AICtx | null>(null);

export function useAI(): AICtx {
  const ctx = React.useContext(AIContext);
  if (!ctx) throw new Error('useAI must be inside <AIProvider>');
  return ctx;
}

// ─── Defaults ───────────────────────────────────────────────────────────────────

const DEFAULT_LOCAL: LocalConfig = {
  baseUrl: 'http://localhost:11434', modelName: '', needsAuth: false, apiKey: '',
};

const DEFAULT_SETTINGS: AISettings = {
  activeProvider:   'claude',
  keys:             {},
  claudeAuthMode:   'cli',
  claudeYoloMode:   false,
  lockedContextFolders: [],
  localConfig:      DEFAULT_LOCAL,
  models:           {},
  effort:           {},
  voiceEnabled:     true,
  showTokenCounter: true,
};

// ─── Provider ───────────────────────────────────────────────────────────────────

export function AIProvider({ dataStore, vaultPath, children }: { dataStore: AIDataStore; vaultPath?: string; children: React.ReactNode }) {
  const [settings,         setSettings]         = React.useState<AISettings>(DEFAULT_SETTINGS);
  const [conversations,    setConversations]    = React.useState<AIConversation[]>([]);
  const [activeConvId,     setActiveConvId]     = React.useState<string | null>(null);
  const [streaming,        setStreaming]        = React.useState(false);
  const [error,            setError]            = React.useState<string | null>(null);
  const [panelOpen,         setPanelOpen]         = React.useState(false);
  const [claudeCliStatus,   setClaudeCliStatus]   = React.useState<CliStatus | null>(null);
  const [checkingClaudeCli, setCheckingClaudeCli] = React.useState(false);
  const [pendingApproval,   setPendingApproval]   = React.useState<PermissionRequest | null>(null);

  const approvalResolveRef = React.useRef<((allow: boolean) => void) | null>(null);

  const respondToApproval = React.useCallback((allow: boolean) => {
    approvalResolveRef.current?.(allow);
    approvalResolveRef.current = null;
    setPendingApproval(null);
  }, []);

  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const streamTextRef    = React.useRef('');
  const streamThinkRef   = React.useRef('');

  React.useEffect(() => {
    dataStore.load().then((data) => {
      if (!data) return;
      if (data.settings) {
        setSettings(s => ({
          ...DEFAULT_SETTINGS,
          ...data.settings,
          keys:        { ...s.keys, ...data.settings.keys },
          models:      { ...s.models, ...data.settings.models },
          effort:      { ...s.effort, ...data.settings.effort },
          localConfig: { ...DEFAULT_LOCAL, ...data.settings.localConfig },
        }));
      }
      if (data.conversations) setConversations(data.conversations);
      if (data.activeConvId)  setActiveConvId(data.activeConvId);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const checkClaudeCli = React.useCallback(async () => {
    setCheckingClaudeCli(true);
    try {
      setClaudeCliStatus(await checkCliStatus());
    } finally {
      setCheckingClaudeCli(false);
    }
  }, []);

  React.useEffect(() => { void checkClaudeCli(); }, [checkClaudeCli]);

  const persist = React.useCallback(
    (s: AISettings, convs: AIConversation[], id: string | null) =>
      dataStore.save({ settings: s, conversations: convs, activeConvId: id }),
    [dataStore],
  );

  const activeConv = conversations.find(c => c.id === activeConvId) ?? null;

  // ── Conversations ────────────────────────────────────────────────────────────

  function newConversation() {
    const s   = settingsRef.current;
    const cfg = PROVIDER_CFG[s.activeProvider];
    const id  = `conv-${Date.now()}`;
    const conv: AIConversation = {
      id, title: 'New conversation',
      providerId: s.activeProvider,
      modelId:    s.models[s.activeProvider] ?? cfg.defaultModel,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
      contextFolders: [...s.lockedContextFolders],
    };
    setConversations(prev => {
      const next = [conv, ...prev];
      persist(s, next, id);
      return next;
    });
    setActiveConvId(id);
    setError(null);
  }

  // ── Context folders (Claude CLI mode — --add-dir, not content dumping) ───────

  function addContextFolder(path: string) {
    if (activeConvId) {
      setConversations(prev => {
        const next = prev.map(c => c.id !== activeConvId ? c : {
          ...c, contextFolders: c.contextFolders?.includes(path) ? c.contextFolders : [...(c.contextFolders ?? []), path],
        });
        persist(settingsRef.current, next, activeConvId);
        return next;
      });
      return;
    }
    // No active conversation yet — start one now, seeded with this folder.
    const s   = settingsRef.current;
    const cfg = PROVIDER_CFG[s.activeProvider];
    const id  = `conv-${Date.now()}`;
    const conv: AIConversation = {
      id, title: 'New conversation',
      providerId: s.activeProvider,
      modelId:    s.models[s.activeProvider] ?? cfg.defaultModel,
      messages: [], createdAt: Date.now(), updatedAt: Date.now(),
      contextFolders: [...new Set([...s.lockedContextFolders, path])],
    };
    setConversations(prev => {
      const next = [conv, ...prev];
      persist(s, next, id);
      return next;
    });
    setActiveConvId(id);
  }

  function removeContextFolder(path: string) {
    if (!activeConvId) return;
    setConversations(prev => {
      const next = prev.map(c => c.id !== activeConvId ? c : { ...c, contextFolders: (c.contextFolders ?? []).filter(p => p !== path) });
      persist(settingsRef.current, next, activeConvId);
      return next;
    });
    if (settingsRef.current.lockedContextFolders.includes(path)) {
      void updateSettings({ lockedContextFolders: settingsRef.current.lockedContextFolders.filter(p => p !== path) });
    }
  }

  function toggleLockContextFolder(path: string) {
    const locked = settingsRef.current.lockedContextFolders;
    void updateSettings({
      lockedContextFolders: locked.includes(path) ? locked.filter(p => p !== path) : [...locked, path],
    });
  }

  function selectConversation(id: string) {
    setActiveConvId(id);
    setError(null);
    persist(settingsRef.current, conversations, id);
  }

  function deleteConversation(id: string) {
    setConversations(prev => {
      const next   = prev.filter(c => c.id !== id);
      const nextId = activeConvId === id ? (next[0]?.id ?? null) : activeConvId;
      setActiveConvId(nextId);
      persist(settingsRef.current, next, nextId);
      return next;
    });
  }

  // ── Send message ──────────────────────────────────────────────────────────────

  async function sendMessage(text: string, files?: string[], images?: ImageAttachment[], opts?: SendMessageOpts) {
    if (!text.trim() || streaming) return;

    const s    = settingsRef.current;
    const pid  = s.activeProvider;
    const cfg  = PROVIDER_CFG[pid];
    const api  = PROVIDER_API[pid];

    // Resolve credential
    let credential = '';
    let localBaseUrl: string | undefined;

    if (pid === 'claude') {
      if (s.claudeAuthMode === 'apikey') {
        credential = s.keys.claude ?? '';
        if (!credential) {
          setError('No Claude API key. Open settings → Connections to add one, or switch back to Claude Code CLI.');
          return;
        }
      } else {
        if (!claudeCliStatus?.installed) {
          setError('Claude Code CLI not found. Install it from claude.com/code, then try again.');
          return;
        }
        if (!claudeCliStatus.authenticated) {
          setError('Claude Code CLI isn’t logged in. Run `claude login` in a terminal once, then try again.');
          return;
        }
      }
    } else if (pid === 'local') {
      localBaseUrl = s.localConfig.baseUrl;
      credential   = s.localConfig.needsAuth ? s.localConfig.apiKey : '';
      if (!s.localConfig.modelName) {
        setError('No model name configured. Open settings → Local AI and enter the model name.');
        return;
      }
    } else {
      credential = s.keys[pid] ?? '';
      if (!credential) {
        setError(`No ${cfg.name} API key. Open settings → Connections to add one.`);
        return;
      }
    }

    setError(null);

    // Resolved once, up front, so the new-conversation's stored `modelId`
    // (below) and the actual API call (further down) never disagree about
    // which model is actually being used for this turn.
    const model = pid === 'local'
      ? s.localConfig.modelName
      : (opts?.useFastModel && cfg.fastModel) ? cfg.fastModel : (s.models[pid] ?? cfg.defaultModel);

    // Auto-create conversation if none active — or if the caller explicitly
    // wants a fresh one (opts.forceNewConversation). Deliberately NOT done by
    // having the caller call newConversation() first and then sendMessage():
    // those would be two separate setState calls, and since this function's
    // own `activeConvId`/`conversations` closure was captured back when this
    // render happened, calling newConversation() immediately before sendMessage()
    // in the same synchronous tick means sendMessage still sees the *old*
    // activeConvId (React hasn't re-rendered in between) — the message would
    // silently land in whatever conversation was active before, while the UI
    // shows the new (empty) one. Forcing the creation through this same
    // branch keeps it atomic with the rest of this call.
    let targetId = opts?.forceNewConversation ? null : activeConvId;
    let freshContextFolders: string[] | undefined;
    if (!targetId) {
      const newId = `conv-${Date.now()}`;
      const newConv: AIConversation = {
        id: newId, title: text.slice(0, 45),
        providerId: pid,
        modelId:    model,
        messages: [], createdAt: Date.now(), updatedAt: Date.now(),
        contextFolders: [...s.lockedContextFolders],
      };
      setConversations(prev => [newConv, ...prev]);
      setActiveConvId(newId);
      targetId = newId;
      freshContextFolders = newConv.contextFolders;
    }

    const convId      = targetId;
    const userMsgId   = `u-${Date.now()}`;
    const asstMsgId   = `a-${Date.now() + 1}`;
    const userMsg: ChatMessage  = { id: userMsgId,  role: 'user',      content: text, files, images, timestamp: Date.now() };
    const asstMsg: ChatMessage  = { id: asstMsgId,  role: 'assistant', content: '',   timestamp: Date.now() + 1 };

    setConversations(prev => prev.map(c => {
      if (c.id !== convId) return c;
      const isFirst = c.messages.length === 0;
      return { ...c, title: isFirst ? text.slice(0, 45) : c.title, messages: [...c.messages, userMsg, asstMsg], updatedAt: Date.now() };
    }));

    setStreaming(true);
    streamTextRef.current  = '';
    streamThinkRef.current = '';

    const effortKey = s.effort[pid] ?? cfg.defaultEffort ?? 'medium';
    const maxTok    = effortToTokens(effortKey);

    const convSnapshot = conversations.find(c => c.id === convId);

    // In Claude CLI mode, a stored session id means the CLI already remembers the
    // whole conversation on disk — claude-cli.ts sends only the newest turn in
    // that case instead of resending everything as flattened text (this is what
    // actually stops token cost from growing with every message). We still pass
    // the full history here regardless, so that if the resume attempt fails
    // (stale/cross-machine session) it has what it needs to fall back to a
    // flattened cold-start rather than losing the conversation entirely.
    const resumeSessionId = (pid === 'claude' && s.claudeAuthMode !== 'apikey') ? convSnapshot?.cliSessionId : undefined;
    const priorMessages = (convSnapshot?.messages ?? []).map(m => ({ role: m.role, content: m.content, images: m.images }));
    const apiMessages   = [...priorMessages, { role: 'user', content: text, images }];

    // Attached folders become --add-dir context directories for Claude's own
    // Read/Glob/Skill tools to browse, rather than us reading and dumping every
    // file's content into the prompt (CLI mode only — other paths have no tools).
    const additionalDirectories = (pid === 'claude' && s.claudeAuthMode !== 'apikey')
      ? (convSnapshot?.contextFolders ?? freshContextFolders)
      : undefined;

    const onSessionId = (id: string) => {
      setConversations(prev => prev.map(c => c.id !== convId ? c : { ...c, cliSessionId: id || undefined }));
    };

    const onToolEvent = (event: ToolCallEvent) => {
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        return {
          ...c, messages: c.messages.map(m => {
            if (m.id !== asstMsgId) return m;
            const existing = m.toolCalls ?? [];
            const idx = existing.findIndex(t => t.id === event.id);
            const toolCalls = idx === -1 ? [...existing, event] : existing.map((t, i) => i === idx ? { ...t, ...event } : t);
            return { ...m, toolCalls };
          }),
        };
      }));
    };

    const onPermissionRequest = (req: PermissionRequest): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        approvalResolveRef.current = resolve;
        setPendingApproval(req);
      });

    const onUsage = (usage: UsageInfo) => {
      setConversations(prev => prev.map(c => {
        if (c.id !== convId) return c;
        return { ...c, messages: c.messages.map(m => m.id === asstMsgId ? { ...m, usage } : m) };
      }));
    };

    const onChunk: ChunkCallback = (chunk, isThinking) => {
      if (isThinking) {
        streamThinkRef.current += chunk;
        const th = streamThinkRef.current;
        setConversations(prev => prev.map(c =>
          c.id !== convId ? c : {
            ...c, messages: c.messages.map(m =>
              m.id === asstMsgId ? { ...m, thinking: th } : m),
          }
        ));
      } else {
        streamTextRef.current += chunk;
        const acc = streamTextRef.current;
        setConversations(prev => prev.map(c =>
          c.id !== convId ? c : {
            ...c, messages: c.messages.map(m =>
              m.id === asstMsgId ? { ...m, content: acc } : m),
          }
        ));
      }
    };

    try {
      await api.sendMessage(apiMessages, model, maxTok, credential, onChunk, {
        localBaseUrl, vaultPath, resumeSessionId, onSessionId, onToolEvent,
        yolo: s.claudeYoloMode, onPermissionRequest, additionalDirectories, onUsage,
      });

      setConversations(prev => {
        const final = prev.map(c => {
          if (c.id !== convId) return c;
          return {
            ...c,
            messages: c.messages.map(m =>
              m.id === asstMsgId
                ? { ...m, content: streamTextRef.current, thinking: streamThinkRef.current || undefined }
                : m,
            ),
            updatedAt: Date.now(),
          };
        });
        persist(settingsRef.current, final, convId);
        return final;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setConversations(prev => prev.map(c =>
        c.id !== convId ? c : { ...c, messages: c.messages.filter(m => m.id !== asstMsgId) },
      ));
    } finally {
      setStreaming(false);
    }
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  async function updateSettings(patch: Partial<AISettings>) {
    // Switching the active provider must bring its own conversation along —
    // otherwise the composer re-brands to the new provider while activeConv still
    // points at whatever conversation (and providerId) was open before, and a
    // send would mix one provider's history into another provider's conversation
    // record. Mirrors what selecting an old chat from History already does.
    let nextActiveConvId: string | null | undefined; // undefined = leave activeConvId alone
    if (patch.activeProvider && patch.activeProvider !== settingsRef.current.activeProvider) {
      const forProvider = conversations.filter(c => c.providerId === patch.activeProvider);
      const mostRecent  = forProvider.length > 0
        ? forProvider.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
        : null;
      nextActiveConvId = mostRecent?.id ?? null;
    }

    setSettings(prev => {
      const next: AISettings = {
        ...prev, ...patch,
        keys:        patch.keys        ? { ...prev.keys,        ...patch.keys        } : prev.keys,
        models:      patch.models      ? { ...prev.models,      ...patch.models      } : prev.models,
        effort:      patch.effort      ? { ...prev.effort,      ...patch.effort      } : prev.effort,
        localConfig: patch.localConfig ? { ...prev.localConfig, ...patch.localConfig } : prev.localConfig,
      };
      settingsRef.current = next;
      void persist(next, conversations, nextActiveConvId !== undefined ? nextActiveConvId : activeConvId);
      return next;
    });

    if (nextActiveConvId !== undefined) {
      setActiveConvId(nextActiveConvId);
      setError(null);
    }
  }

  const value: AICtx = {
    settings, conversations, activeConvId, activeConv,
    streaming, error, panelOpen, setPanelOpen,
    claudeCliStatus, checkingClaudeCli, checkClaudeCli,
    pendingApproval, respondToApproval,
    addContextFolder, removeContextFolder, toggleLockContextFolder,
    newConversation, selectConversation, deleteConversation,
    sendMessage, updateSettings,
    parseSegments,
  };

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}
