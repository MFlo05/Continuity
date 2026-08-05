import { App, Plugin, WorkspaceLeaf, ItemView, ViewStateResult, FileSystemAdapter, TFolder, Platform } from "obsidian";
import { Root, createRoot } from "react-dom/client";
import { createElement } from "react";
import { App as DashboardApp } from "./src/app";
import { ClassPageContent } from "./src/widgets/my-classes/ClassPageContent";
import { AIProvider } from "./src/ai/AIContext";
import { setAssetUrl } from "./src/ai/asset-utils";
import { DEFAULT_PAGES } from "./src/defaults";
import type { PageLayout, MITState } from "./src/types";
import type { GoogleTokens, TokenStore } from "./src/calendar/google-oauth";
import type { AIStoredData, AIDataStore } from "./src/ai/AIContext";
import { setCommandCenterRoot, DEFAULT_COMMAND_CENTER_ROOT } from "./src/data-sources/vault-paths";
import { migratePages } from "./src/core/config-migration";
import { registerBuiltInCodecs } from "./src/core/codecs";
import { CC2SettingTab } from "./src/settings-tab";
import type { SyllabusSource } from "./src/widgets/my-classes/useSyllabusImport";

export const VIEW_TYPE = "cc2-dashboard";
export const VIEW_TYPE_CLASS_PAGE = "cc2-class-page";
// Must stay identical to "id" in manifest.json — Obsidian keys the live
// plugin registry (app.plugins.plugins) off the manifest id.
export const PLUGIN_ID = "continuity";

// Reaches the live plugin instance through the App object — the same trick
// every Obsidian plugin uses to talk to another plugin (or itself) without
// a dependency-injection path. Used by MyClassesWidget to open a class page
// without threading a new capability through the entire WidgetProps/
// GridPage/GridItem chain for the sake of this one widget's one-off need.
export function getCC2Plugin(app: App): CC2Plugin | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
  const plugin = plugins?.plugins?.[PLUGIN_ID];
  return plugin instanceof CC2Plugin ? plugin : null;
}

export interface PluginData {
  pages?:             PageLayout[];
  mitTasks?:          Record<string, MITState | null>;
  googleTokens?:      GoogleTokens;
  aiData?:            AIStoredData;
  commandCenterRoot?: string;

  /**
   * Google OAuth client credentials, supplied per device rather than compiled in.
   *
   * These used to be literals here. They can't be: esbuild inlines them into
   * main.js, main.js is committed, and main.js ships as a public release asset —
   * so a hardcoded value is a published value no matter where the source hides
   * it. GitHub's push protection rejects the push outright.
   *
   * Living in data.json (gitignored) means each install brings its own, from
   * its own Google Cloud project. Neither the repo nor a release carries one.
   *
   * Empty until supplied, which leaves the calendar inert. CalendarProvider
   * checks for that explicitly rather than letting the request fail: a failed
   * refresh reads as an expired session and clears the stored refresh token,
   * so an unconfigured device would silently destroy a working connection.
   *
   * TODO: surface these as fields in CC2SettingTab so they can be entered in
   * the UI instead of by hand-editing data.json.
   */
  googleClientId?:     string;
  googleClientSecret?: string;
}

class CC2View extends ItemView {
  private root:   Root | null = null;
  private plugin: CC2Plugin;

  constructor(leaf: WorkspaceLeaf, plugin: CC2Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType():    string { return VIEW_TYPE; }
  getDisplayText(): string { return "Command Center"; }
  getIcon():        string { return "layout-dashboard"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cc2-root");
    this.root = createRoot(container);
    this.renderApp();
  }

  /**
   * Renders (or re-renders) the dashboard into the existing React root.
   *
   * Separate from onOpen so settings changes can push new props in without
   * tearing the view down. Values like the Google client id are read from
   * pluginData at render time and handed down as props, so editing them in the
   * settings tab did nothing until the whole view was recreated — which read
   * as "the credentials didn't save".
   *
   * Re-rendering the same component into the same root is a reconcile, not a
   * remount: App's state (active page, edit mode) and Gridstack's DOM survive.
   */
  renderApp(): void {
    this.root?.render(
      createElement(DashboardApp, {
        app:             this.app,
        initialPages:    this.plugin.pluginData.pages    ?? DEFAULT_PAGES,
        initialMitTasks: this.plugin.pluginData.mitTasks ?? {},
        tokenStore:      this.plugin.tokenStore,
        aiDataStore:     this.plugin.aiDataStore,
        clientId:        this.plugin.pluginData.googleClientId     ?? "",
        clientSecret:    this.plugin.pluginData.googleClientSecret ?? "",
        savePages: async (pages: PageLayout[]) => {
          this.plugin.pluginData.pages = pages;
          await this.plugin.savePluginData();
        },
        saveMitTasks: async (tasks: Record<string, MITState | null>) => {
          this.plugin.pluginData.mitTasks = tasks;
          await this.plugin.savePluginData();
        },
      }),
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}

// A single, reused tab (like CC2View itself) rather than one per class —
// activateClassView() below always finds-or-creates the one existing leaf
// of this type. setState carries { slug }, which is both how switching
// classes works (setViewState on the same leaf re-triggers setState) and
// how Obsidian's own workspace.json remembers which class was open across
// a full restart, since getState()/setState() are exactly what Obsidian
// persists/restores a leaf's state with.
class ClassPageView extends ItemView {
  private root:   Root | null = null;
  private plugin: CC2Plugin;
  slug: string = "";

  constructor(leaf: WorkspaceLeaf, plugin: CC2Plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType():    string { return VIEW_TYPE_CLASS_PAGE; }
  getDisplayText(): string { return this.slug ? this.slug.toUpperCase() : "Class"; }
  getIcon():        string { return "graduation-cap"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cc2-root");
    this.root = createRoot(container);
    this.render();
  }

  getState(): Record<string, unknown> {
    return { slug: this.slug };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const nextSlug = (state as { slug?: string } | undefined)?.slug;
    if (nextSlug) this.slug = nextSlug;
    await super.setState(state, result);
    this.render();
  }

  private render(): void {
    if (!this.root || !this.slug) return;
    // ClassPageContent is its own independent React root (not nested inside
    // <DashboardApp>'s tree), so it needs its own <AIProvider> — otherwise
    // useAI()/useIsDark() (used for the Import Syllabus button) throw
    // immediately on render with no Provider ancestor, which crashes the
    // whole tree into a blank page. Same dataStore/vaultPath shape app.tsx
    // itself uses.
    const vaultPath = this.app.vault.adapter instanceof FileSystemAdapter ? this.app.vault.adapter.getBasePath() : undefined;
    this.root.render(
      createElement(AIProvider, {
        dataStore: this.plugin.aiDataStore,
        vaultPath,
        children: createElement(ClassPageContent, {
          app:  this.app,
          slug: this.slug,
          onSwitchClass: (nextSlug: string) => {
            void this.leaf.setViewState({ type: VIEW_TYPE_CLASS_PAGE, active: true, state: { slug: nextSlug } });
          },
        }),
      }),
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}

function makeTokenStore(plugin: CC2Plugin): TokenStore {
  return {
    async getTokens(): Promise<GoogleTokens | null> {
      return plugin.pluginData.googleTokens ?? null;
    },
    async saveTokens(tokens: GoogleTokens): Promise<void> {
      plugin.pluginData.googleTokens = tokens;
      await plugin.savePluginData();
    },
    async clearTokens(): Promise<void> {
      delete plugin.pluginData.googleTokens;
      await plugin.savePluginData();
    },
  };
}

function makeAIDataStore(plugin: CC2Plugin): AIDataStore {
  return {
    async load(): Promise<AIStoredData | null> {
      return plugin.pluginData.aiData ?? null;
    },
    async save(data: AIStoredData): Promise<void> {
      plugin.pluginData.aiData = data;
      await plugin.savePluginData();
    },
  };
}

export default class CC2Plugin extends Plugin {
  pluginData:   PluginData   = {};
  tokenStore!:  TokenStore;
  aiDataStore!: AIDataStore;
  // In-memory only — never persisted/serialized. Bridges a syllabus-import
  // request from wherever it was actually initiated (e.g. MyClassesWidget,
  // which lives on the main dashboard's own AIProvider instance) over to the
  // Class Page leaf the user gets navigated to right after — a completely
  // separate, independent AIProvider instance with its own visible AI panel.
  // Without this, sendMessage() would fire correctly but on the WRONG
  // provider instance: the request runs in the (now-backgrounded) dashboard
  // tab's own hidden conversation history, while the user is staring at the
  // class page's own empty panel wondering why nothing happened.
  pendingSyllabusImport: { slug: string; classCode: string; source: SyllabusSource } | null = null;

  async onload(): Promise<void> {
    // Before anything can render: a widget mounting with no codec registered
    // shows its "no codec" error state instead of its data.
    registerBuiltInCodecs();

    this.pluginData   = (await this.loadData() as PluginData | null) ?? {};
    this.tokenStore   = makeTokenStore(this);
    this.aiDataStore  = makeAIDataStore(this);
    setCommandCenterRoot(this.pluginData.commandCenterRoot ?? DEFAULT_COMMAND_CENTER_ROOT);
    this.addSettingTab(new CC2SettingTab(this.app, this));
    this.trackRootFolderRename();

    // Register brand mark assets for AI panel provider logos, plus the
    // Income & Expense Tracker's burning-cash GIF and coin-drop sprite (same
    // resourcePath trick — a relative CSS url() has no base path from an
    // injected <style> tag).
    const adapter = this.app.vault.adapter as any;
    for (const name of ['claude-mark.png', 'gemini-mark.png', 'openai-mark.png', 'burning_money.gif', 'coin-drop.png'] as const) {
      setAssetUrl(name, adapter.getResourcePath(`${this.manifest.dir}/assets/${name}`));
    }

    this.registerView(VIEW_TYPE, (leaf) => new CC2View(leaf, this));
    this.registerView(VIEW_TYPE_CLASS_PAGE, (leaf) => new ClassPageView(leaf, this));

    // Config migration shim (src/core/config-migration.ts) — stamps a typed
    // `config.source` onto widgets that still describe their data source with
    // a legacy key (listFile / budgetName). Strictly additive: legacy keys are
    // left untouched, so nothing reading them changes behavior, and it's
    // idempotent, so an already-migrated layout is never rewritten.
    //
    // Deferred to onLayoutReady because the mapping resolves real vault paths
    // through resolveCommandCenterPath(), which walks the live folder tree —
    // during onload() that tree isn't populated yet and every lookup would
    // fall through to the unprefixed literal.
    this.app.workspace.onLayoutReady(() => { void this.migrateWidgetConfigs(); });

    this.addRibbonIcon("layout-dashboard", "Continuity", () => {
      this.activateView();
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CLASS_PAGE);
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.pluginData);
  }

  /**
   * Push current pluginData into any open dashboard view.
   *
   * Call after changing a setting the React tree receives as a prop (the Google
   * OAuth credentials). Without it the change sits in pluginData and data.json
   * while the mounted view keeps serving the props it captured at open time,
   * so the setting only appears to take effect after an Obsidian reload.
   */
  refreshDashboardViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof CC2View) view.renderApp();
    }
  }

  /**
   * Keeps `commandCenterRoot` pointing at the root folder after the user
   * renames it in Obsidian's file explorer.
   *
   * Without this the setting silently drifts: every path in the plugin is
   * resolved through resolveCommandCenterPath(), which matches the *stored*
   * name against the live folder tree — so renaming the folder makes every
   * widget resolve to a path that no longer exists, and the AI skill hand-offs
   * (Recipe-Creation, budget-capture, Syllabus-Import) start writing notes into
   * a freshly-created folder under the OLD name. The settings tab used to just
   * warn the user to re-type it by hand, which is a footgun, not a fix.
   *
   * Only an exact match on the root's own path is tracked — a rename of some
   * nested folder (Continuity/Recipes → Continuity/Meals) isn't a root change,
   * and resolveVaultPath() is already prefix-tolerant for those.
   */
  private trackRootFolderRename(): void {
    this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
      if (!(file instanceof TFolder)) return;

      const current = this.pluginData.commandCenterRoot ?? DEFAULT_COMMAND_CENTER_ROOT;
      if (oldPath !== current) return;

      this.pluginData.commandCenterRoot = file.path;
      setCommandCenterRoot(file.path);
      await this.savePluginData();
    }));
  }

  // Left undefined-safe on purpose: a vault that has never opened the
  // dashboard has no persisted `pages` at all (DEFAULT_PAGES is applied at
  // view-render time, not here), and materializing it now would persist a
  // default layout the user never asked for.
  private async migrateWidgetConfigs(): Promise<void> {
    const pages = this.pluginData.pages;
    if (!pages?.length) return;

    const result = migratePages(this.app, pages);
    if (!result.changed) return;

    this.pluginData.pages = result.pages;
    await this.savePluginData();
  }

  // Desktop opens the dashboard in the right sidebar, where it reads as a
  // companion panel beside a note. Mobile must not: Obsidian renders both
  // sidebars as drawer overlays there, which are capped well short of the
  // screen width — the dashboard came out as a ~20% strip in portrait and
  // ~40% in landscape, with the note still showing beside it. A phone has no
  // room for a companion panel anyway, so it gets the main workspace area.
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);

    if (!Platform.isMobile) {
      const leaf = leaves[0] ?? workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE, active: true });
      if (leaf) workspace.revealLeaf(leaf);
      return;
    }

    // A leaf parked in a sidebar by an earlier session — or inherited from the
    // desktop layout through a synced workspace.json — renders as a drawer no
    // matter what we do to it here. Reusing it is what makes the strip
    // persist, so find a main-area leaf and drop the sidebar ones entirely
    // rather than leaving a second live dashboard mounted off-screen.
    let leaf = leaves.find(l => l.getRoot() === workspace.rootSplit) ?? null;
    if (!leaf) {
      leaves.forEach(l => l.detach());
      leaf = workspace.getLeaf("tab");
    }

    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  // One shared tab, reused across every class (not one per class) — opening
  // a different class just swaps state on the same leaf. Opens in the main
  // workspace area (getLeaf('tab')), not the right sidebar the dashboard
  // itself uses — the class page is wide/content-heavy, not a side panel.
  async activateClassView(slug: string): Promise<void> {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_CLASS_PAGE);
    const leaf: WorkspaceLeaf = leaves.length > 0 ? leaves[0] : workspace.getLeaf("tab");

    await leaf.setViewState({ type: VIEW_TYPE_CLASS_PAGE, active: true, state: { slug } });
    workspace.revealLeaf(leaf);
  }
}
