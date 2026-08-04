/**
 * AIPanel.tsx — Full chatbot sidebar.
 * Implements the design handoff exactly.
 */

import React, { useState, useEffect, useRef } from 'react';
import { App, FuzzySuggestModal, Notice, TFile, TFolder } from 'obsidian';
import { useAI } from './AIContext';
import type { AIConversation, ChatMessage, ImageAttachment, LocalConfig } from './AIContext';
import type { ToolCallEvent, UsageInfo } from './ai-providers';
import { BrandMark } from './BrandMark';
import { PROVIDER_CFG, providerAccent } from './provider-config';
import type { ProviderId } from './provider-config';
import { InfoTooltip } from '../widgets/shared/InfoTooltip';

// ─── Token/cost usage (Claude only — see ai-providers.ts's UsageInfo) ──────────
// CLI mode's cost is Anthropic's own computed figure (real, even though
// nothing is actually billed on a subscription plan); API-key mode's is our
// own estimate from CLAUDE_PRICING since the API only ever returns raw token
// counts, never a dollar figure — costIsEstimate distinguishes the two so a
// guess is never shown as if it were authoritative.
function formatTokenCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function sumUsage(messages: Pick<ChatMessage, 'usage'>[]): { inputTokens: number; outputTokens: number; costUsd: number; costIsEstimate: boolean } | null {
  let inputTokens = 0, outputTokens = 0, costUsd = 0, costIsEstimate = false, seen = false;
  for (const m of messages) {
    if (!m.usage) continue;
    seen = true;
    inputTokens  += m.usage.inputTokens;
    outputTokens += m.usage.outputTokens;
    if (m.usage.costUsd != null) costUsd += m.usage.costUsd;
    if (m.usage.costIsEstimate) costIsEstimate = true;
  }
  return seen ? { inputTokens, outputTokens, costUsd, costIsEstimate } : null;
}

function UsageLine({ usage }: { usage: UsageInfo }) {
  return (
    <div className="cc2-ai-usage-line">
      {formatTokenCount(usage.inputTokens)} in / {formatTokenCount(usage.outputTokens)} out
      {usage.costUsd != null && <> · {usage.costIsEstimate ? '~' : ''}{formatUsd(usage.costUsd)}</>}
    </div>
  );
}

// ─── Theme vars ────────────────────────────────────────────────────────────────

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(document.body.classList.contains('theme-dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.body.classList.contains('theme-dark')),
    );
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function buildCCVars(isDark: boolean, provider: ProviderId): React.CSSProperties {
  const cfg    = PROVIDER_CFG[provider];
  const accent = providerAccent(cfg, isDark);
  const hex    = accent.replace('#', '');
  const n      = parseInt(hex, 16);
  const rgb    = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;

  const light: Record<string, string> = {
    '--cc-bg':         '#DDD3C3', '--cc-panel':  '#E4DACB', '--cc-raised': '#FAF7F2',
    '--cc-surface':    '#FEFBF6', '--cc-border': 'rgba(30,24,16,0.13)', '--cc-bmid': 'rgba(30,24,16,0.20)',
    '--cc-text':       '#1A1612', '--cc-muted':  '#5C5046', '--cc-faint':  '#9A8A7C',
    '--cc-userbubble': 'rgba(30,24,16,0.055)', '--cc-scrim': 'rgba(30,24,16,0.30)',
    '--cc-shadow':     '0 1px 3px rgba(30,24,16,0.10), 0 12px 34px rgba(30,24,16,0.14)',
  };
  const dark: Record<string, string> = {
    '--cc-bg':         '#131110', '--cc-panel':  '#171513', '--cc-raised': '#1C1A18',
    '--cc-surface':    '#221F1B', '--cc-border': 'rgba(255,248,235,0.08)', '--cc-bmid': 'rgba(255,248,235,0.14)',
    '--cc-text':       '#F0EDE6', '--cc-muted':  '#8C8378', '--cc-faint':  '#5A534C',
    '--cc-userbubble': 'rgba(255,252,245,0.06)', '--cc-scrim': 'rgba(0,0,0,0.55)',
    '--cc-shadow':     '0 1px 0 rgba(0,0,0,0.4), 0 18px 44px rgba(0,0,0,0.5)',
  };
  const base = isDark ? dark : light;

  return {
    ...base,
    '--cc-accent':      accent,
    '--cc-accent-rgb':  rgb,
    '--cc-accent-soft': `rgba(${rgb},0.13)`,
    '--cc-accent-line': `rgba(${rgb},0.34)`,
    '--cc-grad':        cfg.gradient ?? accent,
  } as React.CSSProperties;
}

// ─── File pickers ──────────────────────────────────────────────────────────────

type VaultItem = { path: string; isFolder: boolean };

async function pickVaultItem(app: App): Promise<VaultItem | null> {
  return new Promise(resolve => {
    let done = false;
    class VaultPick extends FuzzySuggestModal<VaultItem> {
      getItems() {
        return app.vault.getAllLoadedFiles()
          .filter(f => f.path !== '' && f.path !== '/')
          .sort((a, b) => {
            const af = a instanceof TFolder, bf = b instanceof TFolder;
            if (af !== bf) return af ? -1 : 1;
            return a.path.localeCompare(b.path);
          })
          .map(f => ({ path: f.path, isFolder: f instanceof TFolder }));
      }
      getItemText(f: VaultItem) { return f.isFolder ? f.path + '/' : f.path; }
      onChooseItem(f: VaultItem) { done = true; resolve(f); }
      onClose()                  { if (!done) resolve(null); }
    }
    new VaultPick(app).open();
  });
}

async function readVaultFile(app: App, path: string): Promise<string | null> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return null;
  try { return await app.vault.read(f); } catch { return null; }
}

// Absolute OS path for a vault-relative path (or the vault root itself when
// relativePath is empty) — this is what Claude's --add-dir needs, since it's a
// real filesystem directory grant, not a vault-relative concept.
function vaultAbsolutePath(app: App, relativePath: string): string | null {
  const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
  if (typeof adapter.getBasePath !== 'function') return null;
  const base = adapter.getBasePath();
  if (!relativePath) return base;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  return path.join(base, relativePath);
}

type AttachedFile =
  | { source: 'vault'; path: string }
  | { source: 'system'; name: string; content: string }
  | { source: 'image'; name: string; mediaType: string; data: string; size: number };

// ─── Image attachments ──────────────────────────────────────────────────────────
// Mirrors Claudian's ImageContextManager: same extensions, same 5MB cap, same
// arrayBuffer→Buffer→base64 encoding.

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

function imageMediaType(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_MEDIA_TYPES[ext] ?? null;
}

async function fileToImageAttachment(file: File): Promise<AttachedFile | null> {
  const mediaType = imageMediaType(file.name) || (file.type.startsWith('image/') ? file.type : null);
  if (!mediaType) { new Notice('Unsupported image type.'); return null; }
  if (file.size > MAX_IMAGE_SIZE) { new Notice(`Image exceeds ${(MAX_IMAGE_SIZE / (1024 * 1024)).toFixed(0)}MB limit.`); return null; }
  const buf  = Buffer.from(await file.arrayBuffer());
  const name = file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`;
  return { source: 'image', name, mediaType, data: buf.toString('base64'), size: file.size };
}

async function pickSystemFiles(): Promise<{ name: string; content: string }[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.accept = '.txt,.md,.json,.csv,.js,.ts,.jsx,.tsx,.py,.html,.css,.yaml,.yml,.xml,.sh';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) { resolve([]); return; }
      const results = await Promise.all(files.map(file =>
        new Promise<{ name: string; content: string }>(res => {
          const reader = new FileReader();
          reader.onload  = () => res({ name: file.name, content: reader.result as string });
          reader.onerror = () => res({ name: file.name, content: '' });
          reader.readAsText(file);
        })
      ));
      resolve(results);
    });
    input.click();
  });
}

async function pickSystemFolder(): Promise<{ name: string; content: string }[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).webkitdirectory = true;
    (input as any).directory = true;
    input.multiple = true;
    const TEXT_EXT = new Set(['md','txt','json','csv','js','ts','jsx','tsx','py','html','css','yaml','yml','xml','sh','toml','env','rs','go','java','rb','php','sql']);
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? [])
        .filter(f => { const ext = f.name.split('.').pop()?.toLowerCase() ?? ''; return TEXT_EXT.has(ext); })
        .slice(0, 50); // cap at 50 files
      if (!files.length) { resolve([]); return; }
      const results = await Promise.all(files.map(file =>
        new Promise<{ name: string; content: string }>(res => {
          const reader = new FileReader();
          reader.onload  = () => res({ name: (file as any).webkitRelativePath || file.name, content: reader.result as string });
          reader.onerror = () => res({ name: file.name, content: '' });
          reader.readAsText(file);
        })
      ));
      resolve(results);
    });
    input.click();
  });
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function IconBtn({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button className={'cc2-ai-icon-btn' + (active ? ' active' : '')} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={'cc2-ai-toggle' + (on ? ' on' : '')} onClick={onToggle}>
      <div className="cc2-ai-toggle-knob" />
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M9.9 5.1A9 9 0 0112 5c6.5 0 10 7 10 7a15.4 15.4 0 01-3 3.6M6.1 6.1A15.3 15.3 0 002 12s3.5 7 10 7a9 9 0 004-.9" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

type StatusTone = 'ok' | 'err' | 'busy' | 'idle';

function statusForProvider(
  pid: ProviderId,
  s: ReturnType<typeof useAI>['settings'],
  localTone: StatusTone,
  claudeCli: ReturnType<typeof useAI>['claudeCliStatus'],
): { tone: StatusTone; label: string } {
  if (pid === 'claude') {
    if (s.claudeAuthMode === 'apikey') return s.keys.claude?.trim() ? { tone: 'ok', label: 'Connected' } : { tone: 'idle', label: 'Not set up' };
    if (claudeCli?.authenticated) return { tone: 'ok',  label: 'Connected' };
    if (claudeCli?.installed)     return { tone: 'err', label: 'Not logged in' };
    return { tone: 'idle', label: 'CLI not found' };
  }
  if (pid === 'gemini') return s.keys.gemini?.trim()   ? { tone: 'ok',  label: 'Connected'  } : { tone: 'idle', label: 'Not set up' };
  if (pid === 'openai') return s.keys.openai?.trim()   ? { tone: 'ok',  label: 'Connected'  } : { tone: 'idle', label: 'Not set up' };
  const labels: Record<StatusTone, string> = { ok: 'Connected', err: 'Error', busy: 'Testing', idle: 'Not set up' };
  return { tone: localTone, label: labels[localTone] };
}

function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  const cols: Record<StatusTone, string> = { ok: '#5F9E6E', err: '#C0574B', busy: 'var(--cc-accent)', idle: 'var(--cc-faint)' };
  const col = cols[tone];
  return (
    <div className="cc2-ai-status-pill" style={{ color: col }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: col, display: 'inline-block', flexShrink: 0, animation: tone === 'busy' ? 'cc2-ai-dot 1s ease-in-out infinite' : 'none' }} />
      {label}
    </div>
  );
}

// ─── Message rendering ─────────────────────────────────────────────────────────

function ThinkingBlock({ text, word, isGradient, open, onToggle, streaming }: {
  text: string; word: string; isGradient: boolean;
  open: boolean; onToggle: () => void; streaming: boolean;
}) {
  const labelStyle: React.CSSProperties = isGradient
    ? { fontSize: 13, fontWeight: 500, backgroundImage: 'var(--cc-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : { fontSize: 13, fontWeight: 500, color: 'var(--cc-accent)', fontStyle: 'italic' };

  return (
    <div className="cc2-ai-think-wrap">
      <div onClick={onToggle} className={'cc2-ai-think-hdr' + (streaming ? ' pulse' : '')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cc-accent)" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4L12 3z" />
        </svg>
        <span style={labelStyle}>{word}</span>
        <span style={{ flex: 1 }} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cc-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </div>
      {open && <div className="cc2-ai-think-body">{text}</div>}
    </div>
  );
}

function ToolCallBlock({ tool, open, onToggle, onApprove, onDeny }: {
  tool: ToolCallEvent; open: boolean; onToggle: () => void;
  onApprove?: () => void; onDeny?: () => void;
}) {
  const active = tool.status === 'running' || tool.status === 'needs-approval';
  const input  = tool.input !== undefined
    ? (typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input, null, 2))
    : '';

  return (
    <div className="cc2-ai-tool-wrap">
      <div onClick={onToggle} className={'cc2-ai-tool-hdr' + (active ? ' pulse' : '')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cc-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 005.4-5.4l-2.8 2.8-2-2 2.8-2.8z" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--cc-text)' }}>{tool.name}</span>
        <span style={{ flex: 1 }} />
        {tool.status === 'done' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5F9E6E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>}
        {tool.status === 'error' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C0574B" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>}
        {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cc-faint)" strokeWidth="2.2" strokeLinecap="round" style={{ animation: 'cc2-ai-spin .8s linear infinite' }}><path d="M12 3a9 9 0 109 9" /></svg>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cc-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </div>
      {tool.status === 'needs-approval' && (
        <div className="cc2-ai-tool-approve-row">
          <span style={{ fontSize: 11.5, color: 'var(--cc-muted)', flex: 1 }}>Wants to run this tool</span>
          <button className="cc2-ai-tool-deny-btn" onClick={onDeny}>Deny</button>
          <button className="cc2-ai-tool-approve-btn" onClick={onApprove}>Approve</button>
        </div>
      )}
      {open && (input || tool.result) && (
        <div className="cc2-ai-tool-body">
          {input && <pre className="cc2-ai-tool-pre">{input}</pre>}
          {tool.result && <div className="cc2-ai-tool-result">{tool.result}</div>}
        </div>
      )}
    </div>
  );
}

function TableSeg({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="cc2-ai-table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="cc2-ai-th">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="cc2-ai-td">{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Welcome screen ────────────────────────────────────────────────────────────

function WelcomeScreen({ provider, isDark, localModel, localEndpoint, onPickSuggestion }: {
  provider: ProviderId; isDark: boolean; localModel: string; localEndpoint: string;
  onPickSuggestion: (text: string) => void;
}) {
  const cfg     = PROVIDER_CFG[provider];
  const isLocal = provider === 'local';

  const greetStyle: React.CSSProperties = cfg.greetingFont === 'serif'
    ? { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif", fontWeight: 400, fontSize: 26, lineHeight: 1.25, color: 'var(--cc-muted)' }
    : cfg.greetingFont === 'gradient'
    ? { fontWeight: 500, fontSize: 25, lineHeight: 1.2, backgroundImage: 'var(--cc-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
    : { fontWeight: 500, fontSize: 24, lineHeight: 1.2, color: 'var(--cc-text)' };

  return (
    <div className="cc2-ai-welcome">
      <div className="cc2-ai-welcome-upper">
        {isLocal ? (
          <>
            <div style={{ color: 'var(--cc-text)' }}><BrandMark provider="local" size={44} isDark={isDark} /></div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--cc-faint)' }}>On-device assistant</div>
            <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 24, fontWeight: 600, color: 'var(--cc-text)' }}>
              {localModel || 'no model set'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--cc-muted)', maxWidth: 272, textAlign: 'center', lineHeight: 1.5 }}>
              Runs entirely on your machine. Nothing you ask ever leaves your vault.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, justifyContent: 'center' }}>
              <span className="cc2-ai-chip-mono"><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5F9E6E' }} />on device</span>
              <span className="cc2-ai-chip-mono">{localEndpoint || 'localhost:11434'}</span>
            </div>
          </>
        ) : (
          <>
            <BrandMark provider={provider} size={50} isDark={isDark} />
            <div style={greetStyle}>{cfg.greeting}</div>
          </>
        )}
      </div>

      <div className="cc2-ai-suggestions">
        {cfg.suggestions.map((sg, i) => (
          <div key={i} className={'cc2-ai-suggestion' + (isLocal ? ' mono' : '')} onClick={() => onPickSuggestion(sg.text)}>
            {isLocal && <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: 'var(--cc-faint)', flexShrink: 0 }}>›</span>}
            {sg.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Thread ────────────────────────────────────────────────────────────────────

function Thread({ conv, provider, isDark, streaming, openThinking, onToggleThinking }: {
  conv: AIConversation; provider: ProviderId; isDark: boolean; streaming: boolean;
  openThinking: Set<string>; onToggleThinking: (id: string) => void;
}) {
  const { parseSegments, pendingApproval, respondToApproval } = useAI();
  const cfg       = PROVIDER_CFG[provider];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());

  function toggleTool(id: string) {
    setOpenTools(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  return (
    <div ref={scrollRef} className="cc2-ai-thread">
      {conv.messages.map((msg, mi) => {
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="cc2-ai-user-row">
              {(msg.files?.length || msg.images?.length) ? (
                <div className="cc2-ai-file-pills">
                  {msg.images?.map((img, ii) => (
                    <span key={`img-${ii}`} className="cc2-ai-file-pill">
                      <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                      {img.name}
                    </span>
                  ))}
                  {msg.files?.filter(f => !msg.images?.some(img => img.name === f)).map((f, fi) => (
                    <span key={fi} className="cc2-ai-file-pill">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /></svg>
                      {f.split('/').pop()}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="cc2-ai-user-bubble">{msg.content}</div>
            </div>
          );
        }

        const isLast      = mi === conv.messages.length - 1;
        const isStreaming = streaming && isLast;
        const segs        = isStreaming && !msg.thinking
          ? [{ type: 'text' as const, text: msg.content }]
          : parseSegments(msg.content, msg.thinking);
        const thinkId = `${msg.id}-think`;

        return (
          <div key={msg.id} className="cc2-ai-asst-row">
            <div className="cc2-ai-asst-avatar">
              <BrandMark provider={provider} size={20} isDark={isDark} />
            </div>
            <div className="cc2-ai-asst-body">
              {isStreaming && !msg.content && !msg.thinking && !msg.toolCalls?.length && (
                <div className="cc2-ai-typing"><span /><span /><span /></div>
              )}
              {segs.filter(s => s.type === 'thinking').map((seg, si) => (
                <ThinkingBlock
                  key={`think-${si}`} text={seg.text ?? ''} word={cfg.thinkWord}
                  isGradient={!!cfg.gradient}
                  open={openThinking.has(thinkId)} onToggle={() => onToggleThinking(thinkId)}
                  streaming={isStreaming}
                />
              ))}
              {msg.toolCalls?.map(tool => (
                <ToolCallBlock
                  key={tool.id} tool={tool}
                  open={openTools.has(tool.id)} onToggle={() => toggleTool(tool.id)}
                  onApprove={pendingApproval?.id === tool.id ? () => respondToApproval(true) : undefined}
                  onDeny={pendingApproval?.id === tool.id ? () => respondToApproval(false) : undefined}
                />
              ))}
              {segs.filter(s => s.type !== 'thinking').map((seg, si) => {
                if (seg.type === 'table') return <TableSeg key={si} cols={seg.cols ?? []} rows={seg.rows ?? []} />;
                return <div key={si} className="cc2-ai-text-seg">{seg.text}</div>;
              })}
              {msg.usage && <UsageLine usage={msg.usage} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── History overlay ────────────────────────────────────────────────────────────

function HistoryOverlay({ conversations, activeId, isDark, onOpen, onDelete, onNew }: {
  conversations: AIConversation[]; activeId: string | null; isDark: boolean;
  onOpen: (id: string) => void; onDelete: (id: string, e: React.MouseEvent) => void;
  onNew: () => void;
}) {
  return (
    <div className="cc2-ai-history">
      <div className="cc2-ai-history-hdr">
        <span className="cc2-ai-micro-label">Conversations</span>
      </div>
      <div style={{ padding: '8px 12px', flexShrink: 0 }}>
        <div className="cc2-ai-new-conv-btn" onClick={onNew}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          New conversation
        </div>
      </div>
      <div className="cc2-ai-history-list">
        {conversations.map(c => {
          const pcfg  = PROVIDER_CFG[c.providerId];
          const dot   = providerAccent(pcfg, isDark);
          const model = pcfg.models.find(m => m.id === c.modelId)?.short ?? c.modelId;
          const when  = new Date(c.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <div key={c.id} className={'cc2-ai-history-row' + (c.id === activeId ? ' active' : '')} onClick={() => onOpen(c.id)}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, marginTop: 4, background: dot }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cc2-ai-history-title">{c.title}</div>
                <div className="cc2-ai-history-meta">{pcfg.name} · {model} · {when}</div>
              </div>
              <div className="cc2-ai-history-del" onClick={e => { e.stopPropagation(); onDelete(c.id, e); }} title="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" /></svg>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Model menu popover ─────────────────────────────────────────────────────────

function ModelMenu({ provider, isDark, onPickModel, onPickEffort, onClose, onOpenSettings }: {
  provider: ProviderId; isDark: boolean;
  onPickModel: (id: string) => void; onPickEffort: (id: string) => void;
  onClose: () => void; onOpenSettings: () => void;
}) {
  const { settings } = useAI();
  const cfg       = PROVIDER_CFG[provider];
  const isLocal   = provider === 'local';
  const selModel  = isLocal ? 'local' : (settings.models[provider] ?? cfg.defaultModel);
  const selEffort = settings.effort[provider] ?? cfg.defaultEffort ?? 'medium';
  const activeText = isDark ? '#17140F' : '#fff';

  const displayModels = isLocal
    ? [{ id: 'local', name: settings.localConfig.modelName || 'No model set', short: '', desc: settings.localConfig.baseUrl }]
    : cfg.models;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={onClose} />
      <div className="cc2-ai-model-menu">
        <div className="cc2-ai-model-menu-hdr">
          <span className="cc2-ai-micro-label" style={{ flex: 1 }}>{cfg.name}</span>
          <span style={{ fontSize: 11, color: 'var(--cc-accent)', cursor: 'pointer' }} onClick={() => { onOpenSettings(); onClose(); }}>Manage</span>
        </div>
        <div style={{ padding: 6 }}>
          {displayModels.map(m => {
            const active = m.id === selModel;
            return (
              <div key={m.id} className={'cc2-ai-model-row' + (active ? ' active' : '')} onClick={() => { onPickModel(m.id); onClose(); }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--cc-text)' }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--cc-faint)', marginTop: 1 }}>{m.desc}</div>
                </div>
                {active && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cc-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12l5 5L20 6" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
        {cfg.hasEffort && !isLocal && (
          <div className="cc2-ai-effort-section">
            <div className="cc2-ai-micro-label" style={{ marginBottom: 8 }}>{cfg.effortLabel}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {cfg.effortOptions.map(ef => {
                const active = ef.id === selEffort;
                return (
                  <div
                    key={ef.id} className="cc2-ai-effort-chip"
                    style={{ background: active ? 'var(--cc-accent)' : 'var(--cc-surface)', color: active ? activeText : 'var(--cc-muted)', border: `1px solid ${active ? 'transparent' : 'var(--cc-border)'}` }}
                    onClick={() => { onPickEffort(ef.id); onClose(); }}
                  >
                    {ef.name}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({ app, provider, isDark, menuOpen, onToggleMenu, onCloseMenu, onOpenSettings, onPickModel, onPickEffort, draft, setDraft, attached, onAttach, onRemoveAttachment, onSend, streaming }: {
  app: App; provider: ProviderId; isDark: boolean;
  menuOpen: boolean; onToggleMenu: () => void; onCloseMenu: () => void;
  onOpenSettings: () => void; onPickModel: (id: string) => void; onPickEffort: (id: string) => void;
  draft: string; setDraft: (s: string) => void; attached: AttachedFile[];
  onAttach: (f: AttachedFile) => void; onRemoveAttachment: (i: number) => void; onSend: () => void; streaming: boolean;
}) {
  const { settings, updateSettings, activeConv, addContextFolder, removeContextFolder, toggleLockContextFolder } = useAI();
  const cfg      = PROVIDER_CFG[provider];
  const isLocal  = provider === 'local';
  const activeText = isDark ? '#17140F' : '#fff';
  const [attachOpen, setAttachOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const supportsImages = provider === 'claude';
  const isClaudeCli    = provider === 'claude' && settings.claudeAuthMode !== 'apikey';
  const contextFolders = isClaudeCli ? (activeConv?.contextFolders ?? []) : [];

  async function attachImageFiles(files: File[]) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (!supportsImages) { new Notice(`Image attachments aren't supported by ${cfg.name} yet.`); continue; }
      const att = await fileToImageAttachment(file);
      if (att) onAttach(att);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) { e.preventDefault(); void attachImageFiles(files); }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropActive(false);
    const files = e.dataTransfer?.files;
    if (files && files.length) void attachImageFiles(Array.from(files));
  }

  const modelShort = isLocal
    ? (settings.localConfig.modelName || 'local')
    : (cfg.models.find(m => m.id === (settings.models[provider] ?? cfg.defaultModel))?.short ?? 'Model');
  const effortName = cfg.hasEffort
    ? (cfg.effortOptions.find(e => e.id === (settings.effort[provider] ?? cfg.defaultEffort))?.name ?? '')
    : '';

  const draftTokens = Math.ceil(draft.length / 4);
  const tokenLabel  = draftTokens >= 1000
    ? `~${(draftTokens / 1000).toFixed(1)}k`
    : `~${draftTokens}`;

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !streaming) { e.preventDefault(); onSend(); }
  }

  return (
    <div className="cc2-ai-composer">
      {menuOpen && (
        <ModelMenu
          provider={provider} isDark={isDark}
          onPickModel={onPickModel} onPickEffort={onPickEffort}
          onClose={onCloseMenu} onOpenSettings={onOpenSettings}
        />
      )}

      {attachOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setAttachOpen(false)} />
          <div className="cc2-ai-attach-menu">
            <div className="cc2-ai-attach-label">Vault</div>
            {isClaudeCli && (
              <div className="cc2-ai-attach-option" onClick={() => {
                setAttachOpen(false);
                const abs = vaultAbsolutePath(app, '');
                if (!abs) { new Notice("Could not resolve the vault's filesystem path."); return; }
                addContextFolder(abs);
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                Vault root (all files)
              </div>
            )}
            <div className="cc2-ai-attach-option" onClick={async () => {
              setAttachOpen(false);
              const item = await pickVaultItem(app);
              if (!item) return;
              if (item.isFolder) {
                if (!isClaudeCli) { new Notice("Folder attachments need Claude Code CLI mode — attach individual files instead, or switch modes in Settings."); return; }
                const abs = vaultAbsolutePath(app, item.path);
                if (!abs) { new Notice("Could not resolve this folder's filesystem path."); return; }
                addContextFolder(abs);
                return;
              }
              onAttach({ source: 'vault', path: item.path });
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
              File or folder…
            </div>
            <div className="cc2-ai-attach-divider" />
            <div className="cc2-ai-attach-label">Computer</div>
            <div className="cc2-ai-attach-option" onClick={async () => {
              setAttachOpen(false);
              const files = await pickSystemFiles();
              files.forEach(f => onAttach({ source: 'system', name: f.name, content: f.content }));
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" /><path d="M13 2v7h7" /></svg>
              Files…
            </div>
            <div className="cc2-ai-attach-option" onClick={async () => {
              setAttachOpen(false);
              const files = await pickSystemFolder();
              files.forEach(f => onAttach({ source: 'system', name: f.name, content: f.content }));
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
              Folder…
            </div>
            {supportsImages && (
              <div className="cc2-ai-attach-option" onClick={() => {
                setAttachOpen(false);
                const input = document.createElement('input');
                input.type = 'file'; input.multiple = true; input.accept = 'image/png,image/jpeg,image/gif,image/webp';
                input.addEventListener('change', () => void attachImageFiles(Array.from(input.files ?? [])));
                input.click();
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                Image…
              </div>
            )}
          </div>
        </>
      )}

      {contextFolders.length > 0 && (
        <div className="cc2-ai-attached-files">
          {contextFolders.map((folderPath, i) => {
            const locked = settings.lockedContextFolders.includes(folderPath);
            const label  = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
            return (
              <span key={i} className="cc2-ai-file-chip cc2-ai-folder-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cc-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                {label}
                <span
                  className={'cc2-ai-folder-lock' + (locked ? ' locked' : '')}
                  title={locked ? 'Locked — attached to every new chat. Click to unlock.' : 'Click to lock — keeps this attached across every new chat, any provider.'}
                  onClick={() => toggleLockContextFolder(folderPath)}
                >
                  {locked ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></svg>
                  )}
                </span>
                <span className="cc2-ai-file-chip-remove" onClick={() => removeContextFolder(folderPath)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </span>
              </span>
            );
          })}
        </div>
      )}

      {attached.length > 0 && (
        <div className="cc2-ai-attached-files">
          {attached.map((f, i) => {
            const label = f.source === 'image' ? f.name
              : f.source === 'system' ? f.name
              : f.path.split('/').pop() ?? f.path;
            return (
              <span key={i} className="cc2-ai-file-chip">
                {f.source === 'image'
                  ? <img src={`data:${f.mediaType};base64,${f.data}`} alt={f.name} style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} />
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--cc-muted)" strokeWidth="2" strokeLinejoin="round"><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /></svg>
                }
                {label}
                <span className="cc2-ai-file-chip-remove" onClick={() => onRemoveAttachment(i)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div
        className={'cc2-ai-input-card' + (dropActive ? ' cc2-ai-drop-active' : '')}
        onDragOver={e => { e.preventDefault(); if (supportsImages) setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        <textarea
          className="cc2-ai-textarea"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          placeholder={isLocal ? `Message ${settings.localConfig.modelName || 'local model'}…` : `Ask ${cfg.name} about your vault…`}
          rows={1}
        />
        <div className="cc2-ai-toolbar">
          <button className="cc2-ai-icon-btn" title="Attach files or folders" onClick={() => setAttachOpen(o => !o)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.6 1.6 0 01-2.3-2.3l8.3-8.3" />
            </svg>
          </button>
          <button className="cc2-ai-model-chip" onClick={onToggleMenu}>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--cc-text)', fontFamily: isLocal ? 'ui-monospace,Menlo,monospace' : 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {modelShort}
            </span>
            {cfg.hasEffort && effortName && (
              <span style={{ fontSize: 11, color: 'var(--cc-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>· {effortName}</span>
            )}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {isClaudeCli && (
            <button
              className={'cc2-ai-yolo-btn' + (settings.claudeYoloMode ? ' active' : '')}
              title={settings.claudeYoloMode
                ? 'YOLO mode: tool actions (Read, Write, Skill, Bash…) run instantly with no approval. Click for Safe mode.'
                : 'Safe mode: tool actions ask for your approval first. Click for YOLO mode (no approval needed).'}
              onClick={() => updateSettings({ claudeYoloMode: !settings.claudeYoloMode })}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={settings.claudeYoloMode ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h7l-1 8 11-14h-7l1-8z" />
              </svg>
              {settings.claudeYoloMode ? 'YOLO' : 'Safe'}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {settings.showTokenCounter && (
            <span className="cc2-ai-token-count">{draft.trim() ? tokenLabel : (isLocal ? 'local' : cfg.contextSize)}</span>
          )}
          <button
            className="cc2-ai-send"
            style={{ background: cfg.gradient ?? 'var(--cc-accent)', color: activeText, opacity: (streaming || !draft.trim()) ? 0.45 : 1 }}
            onClick={onSend}
            disabled={streaming || !draft.trim()}
            title="Send"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings modal ─────────────────────────────────────────────────────────────

type SettingsTab = 'connections' | 'preferences';
type TestState   = 'idle' | 'testing' | 'ok' | 'err';

function SettingsModal({ initProvider, isDark, onClose, onSwitchProvider }: {
  initProvider: ProviderId; isDark: boolean;
  onClose: () => void; onSwitchProvider: (p: ProviderId) => void;
}) {
  const { settings, updateSettings, claudeCliStatus, checkingClaudeCli, checkClaudeCli } = useAI();
  const [tab,      setTab]      = useState<SettingsTab>('connections');
  const [selProv,  setSelProv]  = useState<ProviderId>(initProvider);
  const [pendKeys, setPendKeys] = useState({ ...settings.keys });
  const [pendLoc,  setPendLoc]  = useState<LocalConfig>({ ...settings.localConfig });
  const [testSt,   setTestSt]   = useState<TestState>('idle');
  const [testErr,  setTestErr]  = useState('');
  const [saved,    setSaved]    = useState(false);
  const [gemShow,    setGemShow]    = useState(false);
  const [oaiShow,    setOaiShow]    = useState(false);
  const [locShow,    setLocShow]    = useState(false);
  const [claudeShow, setClaudeShow] = useState(false);

  const snap  = useRef(JSON.stringify({ keys: settings.keys, localConfig: settings.localConfig }));
  const dirty = JSON.stringify({ keys: pendKeys, localConfig: pendLoc }) !== snap.current;

  const cfg        = PROVIDER_CFG[selProv];
  const isLocal    = selProv === 'local';
  const isCli      = cfg.connectionMethod === 'cli';
  const activeText = isDark ? '#17140F' : '#fff';
  const activeModel  = isLocal ? 'local' : (settings.models[selProv] ?? cfg.defaultModel);
  const activeEffort = settings.effort[selProv] ?? cfg.defaultEffort ?? 'medium';
  const localTone: StatusTone = testSt === 'ok' ? 'ok' : testSt === 'err' ? 'err' : testSt === 'testing' ? 'busy' : 'idle';
  const cliState = selProv !== 'claude' ? 'unavailable'
    : checkingClaudeCli                ? 'checking'
    : claudeCliStatus?.authenticated   ? 'connected'
    : claudeCliStatus?.installed       ? 'not-logged-in'
    : 'not-installed';

  async function testConnection() {
    setTestSt('testing'); setTestErr('');
    try {
      const headers: Record<string, string> = {};
      if (pendLoc.needsAuth && pendLoc.apiKey) headers['Authorization'] = `Bearer ${pendLoc.apiKey}`;
      const resp = await fetch(`${pendLoc.baseUrl}/api/tags`, { headers });
      setTestSt(resp.ok ? 'ok' : 'err');
      if (!resp.ok) setTestErr(`Server returned ${resp.status}. Check the base URL is correct and the server is running.`);
    } catch {
      setTestSt('err');
      setTestErr(`Could not reach the server. Is "${pendLoc.baseUrl}" running?`);
    }
  }

  async function save() {
    await updateSettings({ keys: pendKeys, localConfig: pendLoc });
    snap.current = JSON.stringify({ keys: pendKeys, localConfig: pendLoc });
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 900);
  }

  function cancel() {
    const s = JSON.parse(snap.current) as { keys: typeof pendKeys; localConfig: LocalConfig };
    setPendKeys(s.keys);
    setPendLoc(s.localConfig);
    setTestSt('idle');
    onClose();
  }

  function switchProv(pid: ProviderId) {
    setSelProv(pid);
    setTestSt('idle');
    onSwitchProvider(pid);
  }

  const dotCol: Record<StatusTone, string> = { ok: '#5F9E6E', err: '#C0574B', busy: 'var(--cc-accent)', idle: 'var(--cc-faint)' };

  return (
    <div className="cc2-ai-settings-scrim" onClick={e => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="cc2-ai-settings-modal" onClick={e => e.stopPropagation()}>

        <div className="cc2-ai-settings-hdr">
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--cc-text)', letterSpacing: '-0.01em' }}>Assistant settings</span>
          <IconBtn title="Close" onClick={cancel}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </IconBtn>
        </div>

        <div className="cc2-ai-tab-bar">
          {(['connections', 'preferences'] as SettingsTab[]).map(t => (
            <div key={t} className={'cc2-ai-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </div>
          ))}
        </div>

        <div className="cc2-ai-settings-body">

          {tab === 'connections' && (
            <>
              {/* Provider grid */}
              <div className="cc2-ai-provider-grid">
                {(['claude', 'gemini', 'openai', 'local'] as ProviderId[]).map(pid => {
                  const pcfg = PROVIDER_CFG[pid];
                  const lt   = pid === 'local' ? localTone : 'idle' as StatusTone;
                  const st   = statusForProvider(pid, settings, lt, claudeCliStatus);
                  return (
                    <div key={pid} className={'cc2-ai-prov-card' + (pid === selProv ? ' active' : '')} onClick={() => switchProv(pid)}>
                      <div style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%', background: dotCol[st.tone], animation: st.tone === 'busy' ? 'cc2-ai-dot 1s ease-in-out infinite' : 'none' }} />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 24 }}>
                        <BrandMark provider={pid} size={22} isDark={isDark} />
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--cc-text)', textAlign: 'center' }}>{pcfg.name}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase' as const, color: st.tone === 'ok' ? '#5F9E6E' : st.tone === 'err' ? '#C0574B' : 'var(--cc-faint)' }}>{st.label}</div>
                    </div>
                  );
                })}
              </div>

              {/* Detail header */}
              <div className="cc2-ai-prov-detail-hdr">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}>
                  <BrandMark provider={selProv} size={28} isDark={isDark} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cc-text)', lineHeight: 1.1 }}>{cfg.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--cc-faint)', marginTop: 2 }}>{cfg.vendor}</div>
                </div>
                <StatusPill {...statusForProvider(selProv, settings, localTone, claudeCliStatus)} />
              </div>

              {/* Claude: CLI (subscription) or API key (pay-per-use) */}
              {isCli && selProv === 'claude' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="cc2-ai-tab-bar">
                    <div
                      className={'cc2-ai-tab' + (settings.claudeAuthMode !== 'apikey' ? ' active' : '')}
                      onClick={() => updateSettings({ claudeAuthMode: 'cli' })}
                    >
                      Claude Code CLI
                    </div>
                    <div
                      className={'cc2-ai-tab' + (settings.claudeAuthMode === 'apikey' ? ' active' : '')}
                      onClick={() => updateSettings({ claudeAuthMode: 'apikey' })}
                    >
                      API key
                    </div>
                  </div>

                  {settings.claudeAuthMode === 'apikey' ? (
                    <>
                      <div className="cc2-ai-error-bar" style={{ borderRadius: 8 }}>
                        <span style={{ flex: 1, fontSize: 12 }}>You're no longer using your Claude subscription — this bills your Anthropic API account per token instead.</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label className="cc2-ai-field-label">Anthropic API Key</label>
                      </div>
                      <div style={{ position: 'relative' }}>
                        <input className="cc2-ai-input" type={claudeShow ? 'text' : 'password'} value={pendKeys.claude ?? ''} onChange={e => setPendKeys(p => ({ ...p, claude: e.target.value }))} placeholder="sk-ant-…" />
                        <button className="cc2-ai-eye-btn" onClick={() => setClaudeShow(s => !s)}><EyeIcon open={claudeShow} /></button>
                      </div>
                      <div className="cc2-ai-hint">Create a key at console.anthropic.com → API Keys. Billed pay-as-you-go, separate from any Claude.ai subscription.</div>
                    </>
                  ) : (
                    <>
                      {cliState === 'checking' && (
                        <div className="cc2-ai-oauth-busy">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: 'cc2-ai-spin .8s linear infinite' }}><path d="M12 3a9 9 0 109 9" /></svg>
                          Checking for Claude Code CLI…
                        </div>
                      )}
                      {cliState === 'connected' && (
                        <div className="cc2-ai-connected-card">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5F9E6E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 12l5 5L20 6" /></svg>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cc-text)' }}>Connected via Claude Code CLI</div>
                            <div style={{ fontSize: 11.5, color: 'var(--cc-muted)', marginTop: 1 }}>{cfg.cliConnectedHint}</div>
                          </div>
                          <button className="cc2-ai-disconnect-btn" onClick={() => checkClaudeCli()}>Recheck</button>
                        </div>
                      )}
                      {(cliState === 'not-logged-in' || cliState === 'not-installed') && (
                        <>
                          <div className="cc2-ai-hint">
                            {cliState === 'not-installed' ? cfg.cliNotFoundHint : cfg.cliNotLoggedInHint}
                          </div>
                          <button className="cc2-ai-oauth-btn" style={{ background: 'transparent', color: 'var(--cc-muted)', border: '1px solid var(--cc-border)' }} onClick={() => checkClaudeCli()}>
                            Recheck
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Gemini API key */}
              {selProv === 'gemini' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className="cc2-ai-field-label">Google AI API Key</label>
                    {cfg.infoTooltip && <InfoTooltip text={cfg.infoTooltip} />}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input className="cc2-ai-input" type={gemShow ? 'text' : 'password'} value={pendKeys.gemini ?? ''} onChange={e => setPendKeys(p => ({ ...p, gemini: e.target.value }))} placeholder="AIza…" />
                    <button className="cc2-ai-eye-btn" onClick={() => setGemShow(s => !s)}><EyeIcon open={gemShow} /></button>
                  </div>
                  <div className="cc2-ai-hint">Get a free key at aistudio.google.com → Get API key.</div>
                </div>
              )}

              {/* OpenAI API key */}
              {selProv === 'openai' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className="cc2-ai-field-label">OpenAI API Key</label>
                    {cfg.infoTooltip && <InfoTooltip text={cfg.infoTooltip} />}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input className="cc2-ai-input" type={oaiShow ? 'text' : 'password'} value={pendKeys.openai ?? ''} onChange={e => setPendKeys(p => ({ ...p, openai: e.target.value }))} placeholder="sk-proj-…" />
                    <button className="cc2-ai-eye-btn" onClick={() => setOaiShow(s => !s)}><EyeIcon open={oaiShow} /></button>
                  </div>
                  <div className="cc2-ai-hint">Create a key at platform.openai.com → API keys. Pay-as-you-go.</div>
                </div>
              )}

              {/* Local AI */}
              {isLocal && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--cc-text)' }}>Local server</span>
                    {cfg.infoTooltip && <InfoTooltip text={cfg.infoTooltip} />}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label className="cc2-ai-field-label">Base URL</label>
                    <input className="cc2-ai-input plain" value={pendLoc.baseUrl} onChange={e => { setPendLoc(p => ({ ...p, baseUrl: e.target.value })); setTestSt('idle'); }} placeholder="http://localhost:11434" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <label className="cc2-ai-field-label">Model name</label>
                    <input className="cc2-ai-input plain" value={pendLoc.modelName} onChange={e => { setPendLoc(p => ({ ...p, modelName: e.target.value })); setTestSt('idle'); }} placeholder="e.g. llama3.2 or mistral:7b" />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--cc-muted)' }}>Server requires authentication</span>
                    <Toggle on={pendLoc.needsAuth} onToggle={() => setPendLoc(p => ({ ...p, needsAuth: !p.needsAuth }))} />
                  </div>
                  {pendLoc.needsAuth && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <label className="cc2-ai-field-label">API Key</label>
                      <div style={{ position: 'relative' }}>
                        <input className="cc2-ai-input" type={locShow ? 'text' : 'password'} value={pendLoc.apiKey} onChange={e => setPendLoc(p => ({ ...p, apiKey: e.target.value }))} placeholder="Optional bearer token" />
                        <button className="cc2-ai-eye-btn" onClick={() => setLocShow(s => !s)}><EyeIcon open={locShow} /></button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
                    <button className="cc2-ai-test-btn" onClick={testConnection} disabled={testSt === 'testing'}>
                      {testSt === 'testing'
                        ? <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ animation: 'cc2-ai-spin .8s linear infinite' }}><path d="M12 3a9 9 0 109 9" /></svg>Testing…</>
                        : <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4.5 12.5H11l-1 9L19.5 11H13z" /></svg>Test connection</>
                      }
                    </button>
                    {testSt === 'ok'  && <span style={{ fontSize: 12.5, fontWeight: 500, color: '#5F9E6E' }}>✓ Connection successful</span>}
                    {testSt === 'err' && <span style={{ fontSize: 12.5, fontWeight: 500, color: '#C0574B' }}>✗ Connection failed</span>}
                  </div>
                  {testSt === 'err' && testErr && <div style={{ fontSize: 11.5, color: '#C0574B', lineHeight: 1.45 }}>{testErr}</div>}
                </div>
              )}
            </>
          )}

          {tab === 'preferences' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div>
                <div className="cc2-ai-micro-label" style={{ marginBottom: 9 }}>Default model — {cfg.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(isLocal
                    ? [{ id: 'local', name: settings.localConfig.modelName || 'No model set', short: '', desc: settings.localConfig.baseUrl }]
                    : cfg.models
                  ).map(m => {
                    const active = m.id === activeModel;
                    return (
                      <div key={m.id} className={'cc2-ai-model-setting-row' + (active ? ' active' : '')} onClick={() => { if (!isLocal) updateSettings({ models: { ...settings.models, [selProv]: m.id } }); }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--cc-text)' }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--cc-faint)', marginTop: 1 }}>{m.desc}</div>
                        </div>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? 'var(--cc-accent)' : 'var(--cc-bmid)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {active && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cc-accent)' }} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {cfg.hasEffort && (
                <div>
                  <div className="cc2-ai-micro-label" style={{ marginBottom: 9 }}>{cfg.effortLabel}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
                    {cfg.effortOptions.map(ef => {
                      const active = ef.id === activeEffort;
                      return (
                        <div key={ef.id} className="cc2-ai-effort-chip"
                          style={{ background: active ? 'var(--cc-accent)' : 'var(--cc-surface)', color: active ? activeText : 'var(--cc-muted)', border: `1px solid ${active ? 'transparent' : 'var(--cc-border)'}` }}
                          onClick={() => updateSettings({ effort: { ...settings.effort, [selProv]: ef.id } })}
                        >{ef.name}</div>
                      );
                    })}
                  </div>
                  <div className="cc2-ai-hint" style={{ marginTop: 9 }}>{cfg.effortHint}</div>
                </div>
              )}

              <div>
                <div className="cc2-ai-micro-label" style={{ marginBottom: 11 }}>General</div>
                {([
                  { label: 'Show token counter', key: 'showTokenCounter' },
                ] as const).map(({ label, key }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--cc-text)' }}>{label}</span>
                    <Toggle on={settings[key]} onToggle={() => updateSettings({ [key]: !settings[key] })} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="cc2-ai-settings-footer">
          <span style={{ flex: 1, fontSize: 11.5, color: saved ? '#5F9E6E' : 'var(--cc-faint)', fontWeight: saved ? 500 : 400 }}>
            {saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}
          </span>
          <button className="cc2-ai-cancel-btn" onClick={cancel}>Cancel</button>
          <button
            className="cc2-ai-primary-btn"
            style={{ background: cfg.gradient ?? 'var(--cc-accent)', color: activeText }}
            onClick={dirty ? save : onClose}
          >
            {dirty ? 'Save' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ────────────────────────────────────────────────────────────────

export function AIPanel({ app }: { app: App }) {
  const {
    settings, conversations, activeConvId, activeConv,
    streaming, error, panelOpen, setPanelOpen,
    newConversation, selectConversation, deleteConversation,
    sendMessage, updateSettings,
  } = useAI();

  const provider = settings.activeProvider;
  const cfg      = PROVIDER_CFG[provider];
  const isDark   = useIsDark();
  const ccVars   = buildCCVars(isDark, provider);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [historyOpen,  setHistoryOpen]  = useState(false);
  const [draft,        setDraft]        = useState('');
  const [attached,     setAttached]     = useState<AttachedFile[]>([]);
  const [openThinking, setOpenThinking] = useState<Set<string>>(new Set());

  const isLocal    = provider === 'local';
  const localModel = settings.localConfig.modelName;
  const localEndpt = settings.localConfig.baseUrl.replace(/^https?:\/\//, '');
  const showWelcome = !activeConv || activeConv.messages.length === 0;

  const modelShort = isLocal
    ? (localModel || 'no model')
    : (cfg.models.find(m => m.id === (settings.models[provider] ?? cfg.defaultModel))?.short ?? '');
  const convTitle = activeConv?.title ?? 'New chat';
  const stripDot  = isLocal ? '#5F9E6E' : providerAccent(cfg, isDark);
  const convUsage = activeConv ? sumUsage(activeConv.messages) : null;

  async function handleSend() {
    if (!draft.trim() || streaming) return;
    let text = draft;
    const displayNames: string[] = [];
    const images: ImageAttachment[] = [];
    if (attached.length > 0) {
      const sections: string[] = [];
      for (const f of attached) {
        if (f.source === 'vault') {
          const content = await readVaultFile(app, f.path);
          if (content !== null) sections.push(`**Attached: ${f.path}**\n\`\`\`\n${content}\n\`\`\``);
          displayNames.push(f.path);
        } else if (f.source === 'image') {
          images.push({ name: f.name, mediaType: f.mediaType, data: f.data });
          displayNames.push(f.name);
        } else {
          sections.push(`**Attached: ${f.name}**\n\`\`\`\n${f.content}\n\`\`\``);
          displayNames.push(f.name);
        }
      }
      if (sections.length) text = sections.join('\n\n') + '\n\n' + draft;
    }
    setDraft(''); setAttached([]);
    await sendMessage(text, displayNames.length ? displayNames : undefined, images.length ? images : undefined);
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find(c => c.id === id);
    if (conv && conv.providerId !== provider) {
      updateSettings({ activeProvider: conv.providerId, models: { ...settings.models, [conv.providerId]: conv.modelId } });
    }
    selectConversation(id);
    setHistoryOpen(false);
  }

  function handlePickModel(id: string) {
    updateSettings({ models: { ...settings.models, [provider]: id } });
  }

  function handlePickEffort(id: string) {
    updateSettings({ effort: { ...settings.effort, [provider]: id } });
  }

  function toggleThinking(id: string) {
    setOpenThinking(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="cc2-ai-root" style={{ ...ccVars, '--panel-x': panelOpen ? '0px' : '112%' } as React.CSSProperties}>

      <div className="cc2-ai-panel">

        <div className="cc2-ai-panel-hdr">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30 }}>
            <BrandMark provider={provider} size={28} isDark={isDark} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cc-text)', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{cfg.name}</div>
            <div className="cc2-ai-micro-label" style={{ marginTop: 2 }}>Vault Assistant</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconBtn title="New conversation" onClick={() => { newConversation(); setHistoryOpen(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </IconBtn>
            <IconBtn title="Conversations" onClick={() => setHistoryOpen(h => !h)} active={historyOpen}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
            </IconBtn>
            <IconBtn title="Settings" onClick={() => setSettingsOpen(true)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
              </svg>
            </IconBtn>
            <IconBtn title="Collapse" onClick={() => setPanelOpen(false)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </IconBtn>
          </div>
        </div>

        <div className="cc2-ai-conv-strip">
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: stripDot, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: 'var(--cc-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{convTitle}</div>
          <div style={{ fontSize: 11, color: 'var(--cc-faint)', flexShrink: 0, fontFamily: isLocal ? 'ui-monospace,Menlo,monospace' : 'inherit' }}>{modelShort}</div>
          {convUsage && (
            <div
              className="cc2-ai-usage-total"
              title={`${formatTokenCount(convUsage.inputTokens)} in / ${formatTokenCount(convUsage.outputTokens)} out for this conversation`}
            >
              {convUsage.costIsEstimate ? '~' : ''}{formatUsd(convUsage.costUsd)}
            </div>
          )}
        </div>

        <div className="cc2-ai-body">
          {showWelcome ? (
            <WelcomeScreen provider={provider} isDark={isDark} localModel={localModel} localEndpoint={localEndpt} onPickSuggestion={text => setDraft(text)} />
          ) : activeConv ? (
            <Thread conv={activeConv} provider={provider} isDark={isDark} streaming={streaming} openThinking={openThinking} onToggleThinking={toggleThinking} />
          ) : null}

          {historyOpen && (
            <HistoryOverlay
              conversations={conversations} activeId={activeConvId} isDark={isDark}
              onOpen={handleSelectConversation}
              onDelete={(id, e) => { e.stopPropagation(); deleteConversation(id); }}
              onNew={() => { newConversation(); setHistoryOpen(false); }}
            />
          )}
        </div>

        {error && (
          <div className="cc2-ai-error-bar">
            <span style={{ flex: 1, fontSize: 12 }}>{error}</span>
          </div>
        )}

        <Composer
          app={app} provider={provider} isDark={isDark}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen(m => !m)}
          onCloseMenu={() => setMenuOpen(false)}
          onOpenSettings={() => { setMenuOpen(false); setSettingsOpen(true); }}
          onPickModel={handlePickModel}
          onPickEffort={handlePickEffort}
          draft={draft} setDraft={setDraft}
          attached={attached}
          onAttach={f => setAttached(a => [...a, f])}
          onRemoveAttachment={i => setAttached(a => a.filter((_, idx) => idx !== i))}
          onSend={handleSend}
          streaming={streaming}
        />

        {settingsOpen && (
          <SettingsModal
            initProvider={provider}
            isDark={isDark}
            onClose={() => setSettingsOpen(false)}
            onSwitchProvider={pid => updateSettings({ activeProvider: pid })}
          />
        )}
      </div>
    </div>
  );
}
