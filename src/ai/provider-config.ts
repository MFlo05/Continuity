/**
 * provider-config.ts — Pure UI/brand config for each AI provider.
 * API call logic lives in ai-providers.ts; this file is design-only data.
 */

export type ProviderId = 'claude' | 'gemini' | 'openai' | 'local';

export interface EffortOption  { id: string; name: string; }
export interface ProviderModel { id: string; name: string; short: string; desc: string; }
export interface Suggestion    { label: string; text: string; }

export interface ProviderCfg {
  id:               ProviderId;
  name:             string;
  vendor:           string;
  connectionMethod: 'cli' | 'apikey' | 'local';
  accentLight:      string;
  accentDark:       string;
  gradient?:        string;        // Gemini only
  greeting:         string;
  greetingFont:     'serif' | 'gradient' | 'sans';
  thinkWord:        string;        // "Thinking" | "Reasoning"
  hasEffort:        boolean;
  effortLabel:      string;
  effortHint:       string;
  effortOptions:    EffortOption[];
  defaultEffort:    string | null;
  contextSize:      string;
  models:           ProviderModel[];
  defaultModel:     string;
  // The cheapest/quickest model this provider offers, for callers that want
  // to override the user's globally-selected model for a bounded, mechanical
  // task (see SendMessageOpts.useFastModel in AIContext.tsx) — e.g. the
  // budget-cleanup skill doesn't need the user's heavier default model.
  // Omitted for 'local': there's no metered cost to economize on, and the
  // user already picked whatever single model they run.
  fastModel?:       string;
  suggestions:      Suggestion[];
  // 'cli' providers (Claude — detected via the Claude Code CLI, no key entry)
  cliNotFoundHint?:     string;
  cliNotLoggedInHint?:  string;
  cliConnectedHint?:    string;
  // info tooltip (shown on ℹ hover in connection form)
  infoTooltip?:       string;
}

const BRAND_SUGGESTIONS: Suggestion[] = [
  { label: 'Categorize my October budget',  text: 'Categorize my October spending from my notes and flag anything unusual.' },
  { label: 'Summarize my day',              text: 'Summarize what I got done today from my daily note.' },
  { label: 'Run my weekly review',          text: 'Give me a weekly review summary for this week.' },
  { label: 'Tidy up my inbox notes',        text: 'Triage and organize my inbox notes.' },
];

const LOCAL_SUGGESTIONS: Suggestion[] = [
  { label: 'Draft a standup from my daily note', text: 'Draft a short standup update from my daily note. Keep it to 3 bullets.' },
  { label: 'Summarize this note in 3 lines',     text: 'Summarize the current note in three lines.' },
  { label: 'Rewrite the selection more concisely', text: 'Rewrite my selection to be more concise.' },
  { label: 'Fix grammar in this note',            text: 'Fix any grammar or spelling issues in this note.' },
];

export const PROVIDER_CFG: Record<ProviderId, ProviderCfg> = {

  claude: {
    id: 'claude', name: 'Claude', vendor: 'Anthropic',
    connectionMethod: 'cli',
    accentLight: '#C05A38', accentDark: '#E0876B',
    greeting: 'How can I help in your vault?', greetingFont: 'serif',
    thinkWord: 'Thinking', hasEffort: true,
    effortLabel: 'Output level',
    effortHint: 'Output level controls how far Claude reasons before answering — Low for quick replies, Ultra for the deepest analysis of complex vault tasks.',
    effortOptions: [
      { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }, { id: 'ultra', name: 'Ultra' },
    ],
    defaultEffort: 'medium', contextSize: '200K',
    models: [
      { id: 'claude-opus-4-8',           name: 'Claude Opus 4',    short: 'Opus 4',    desc: 'Most capable'     },
      { id: 'claude-sonnet-4-6',         name: 'Claude Sonnet 4',  short: 'Sonnet 4',  desc: 'Balanced · default' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', short: 'Haiku 4.5', desc: 'Fastest'          },
    ],
    defaultModel: 'claude-sonnet-4-6',
    fastModel: 'claude-haiku-4-5-20251001',
    cliNotFoundHint:    'Claude Code CLI not found on this machine. Install it from claude.com/code, then click Recheck.',
    cliNotLoggedInHint: 'Claude Code CLI is installed but not logged in. Run `claude login` in a terminal once, then click Recheck.',
    cliConnectedHint:   'Uses your existing Claude Pro or Max subscription via the Claude Code CLI already installed on this machine — no API key needed.',
    suggestions: BRAND_SUGGESTIONS,
  },

  gemini: {
    id: 'gemini', name: 'Gemini', vendor: 'Google',
    connectionMethod: 'apikey',
    accentLight: '#3B6FE0', accentDark: '#89A9F7',
    gradient: 'linear-gradient(135deg,#4285F4 0%,#9B72CB 52%,#D96570 100%)',
    greeting: 'Hello. How can I help?', greetingFont: 'gradient',
    thinkWord: 'Thinking', hasEffort: true,
    effortLabel: 'Thinking level',
    effortHint: 'Gemini sets its thinking level automatically. Lower it to Minimal for fast lookups, or keep it High for complex reasoning.',
    effortOptions: [
      { id: 'minimal', name: 'Minimal' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' },
    ],
    defaultEffort: 'high', contextSize: '1M',
    models: [
      { id: 'gemini-2.0-flash',   name: 'Gemini 2.0 Flash',  short: 'Gemini 2.0 Flash',  desc: 'Fast · default' },
      { id: 'gemini-1.5-pro',     name: 'Gemini 1.5 Pro',    short: 'Gemini 1.5 Pro',    desc: 'Advanced reasoning' },
      { id: 'gemini-1.5-flash',   name: 'Gemini 1.5 Flash',  short: 'Gemini 1.5 Flash',  desc: 'Efficient' },
    ],
    defaultModel: 'gemini-2.0-flash',
    // Already the fastest/cheapest model in this list — set explicitly so a
    // useFastModel request still forces this even if the user's global
    // Gemini setting has been switched to 1.5 Pro.
    fastModel: 'gemini-2.0-flash',
    infoTooltip: 'Get a free API key at aistudio.google.com → "Get API key". Your key is stored only in your Obsidian vault data — it never leaves your device except in direct requests to Google\'s servers.',
    suggestions: BRAND_SUGGESTIONS,
  },

  openai: {
    id: 'openai', name: 'ChatGPT', vendor: 'OpenAI',
    connectionMethod: 'apikey',
    accentLight: '#1A1612', accentDark: '#F0EDE6',
    greeting: 'What are you working on?', greetingFont: 'sans',
    thinkWord: 'Reasoning', hasEffort: true,
    effortLabel: 'Reasoning effort',
    effortHint: 'Reasoning effort controls how much the model thinks before answering. Medium is the best balance for most tasks.',
    effortOptions: [
      { id: 'none', name: 'None' }, { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }, { id: 'xhigh', name: 'xHigh' },
    ],
    defaultEffort: 'medium', contextSize: '128K',
    models: [
      { id: 'gpt-4o',      name: 'GPT-4o',      short: 'GPT-4o',      desc: 'Flagship · default' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', short: 'GPT-4o mini', desc: 'Faster, lighter'    },
      { id: 'o3-mini',     name: 'o3-mini',     short: 'o3-mini',     desc: 'Reasoning model'    },
    ],
    defaultModel: 'gpt-4o',
    fastModel: 'gpt-4o-mini',
    infoTooltip: 'Get an API key at platform.openai.com → "API keys". ChatGPT charges per use (pay-as-you-go). Your key is stored only in your Obsidian vault data — it never leaves your device except in direct requests to OpenAI\'s servers.',
    suggestions: BRAND_SUGGESTIONS,
  },

  local: {
    id: 'local', name: 'Local AI', vendor: 'On device · Ollama, LM Studio, Jan',
    connectionMethod: 'local',
    accentLight: '#1A1612', accentDark: '#F0EDE6',
    greeting: 'On-device assistant', greetingFont: 'sans',
    thinkWord: 'Reasoning', hasEffort: false,
    effortLabel: '', effortHint: '', effortOptions: [], defaultEffort: null,
    contextSize: 'on device',
    models: [],
    defaultModel: 'local',
    infoTooltip: 'Run a local model with software like Ollama (ollama.ai), LM Studio, or Jan. Start the server, then enter the URL it\'s listening on — Ollama\'s default is http://localhost:11434. Enter the model name exactly as it appears in your software, e.g. "llama3.2" or "mistral:7b". Ollama requires an exact match with a model you\'ve already pulled. Nothing you type ever leaves your machine.',
    suggestions: LOCAL_SUGGESTIONS,
  },
};

export function providerAccent(cfg: ProviderCfg, isDark: boolean): string {
  return isDark ? cfg.accentDark : cfg.accentLight;
}
