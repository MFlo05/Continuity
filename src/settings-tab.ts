import { App, PluginSettingTab, Setting } from 'obsidian';
import type CC2Plugin from '../main';
import { DEFAULT_COMMAND_CENTER_ROOT, setCommandCenterRoot } from './data-sources/vault-paths';

// Native Obsidian settings tab (Settings -> Community Plugins -> Command
// Center V2) rather than a custom React panel — this is a single simple text
// field with no interaction beyond "type a value, it saves", so the built-in
// Setting API is the right tool, not another AIPanel-style modal.
export class CC2SettingTab extends PluginSettingTab {
  plugin: CC2Plugin;

  constructor(app: App, plugin: CC2Plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Command Center root folder')
      .setDesc(
        'The vault folder every widget reads and writes to (Finance/Ledgers, todos, ' +
        'groceries, meal-plans, Meetings, Recipes, Skills, etc). Renaming the folder ' +
        'in Obsidian updates this automatically — you only need to edit it here if ' +
        'you point the plugin at a different folder entirely.',
      )
      .addText(text => text
        .setPlaceholder(DEFAULT_COMMAND_CENTER_ROOT)
        .setValue(this.plugin.pluginData.commandCenterRoot ?? DEFAULT_COMMAND_CENTER_ROOT)
        .onChange(async value => {
          const trimmed = value.trim() || DEFAULT_COMMAND_CENTER_ROOT;
          this.plugin.pluginData.commandCenterRoot = trimmed;
          setCommandCenterRoot(trimmed);
          await this.plugin.savePluginData();
        }));

    // ── Google Calendar ──────────────────────────────────────────────────────
    // Entered per device rather than compiled in. They can't be literals in the
    // source: esbuild inlines them into main.js, which is committed and shipped
    // as a public release asset, so a hardcoded value is a published value.
    //
    // These belong in the UI and not just in data.json. Editing that file by
    // hand while Obsidian is running does nothing — the plugin holds pluginData
    // in memory and the next save writes it straight back over your edit.
    containerEl.createEl('h3', { text: 'Google Calendar' });

    const desc = containerEl.createEl('p', {
      text:
        'From a Google Cloud project with the Calendar API enabled, using an ' +
        'OAuth client of type "Desktop app". Stored only on this device, in ' +
        'this vault. The calendar stays disconnected until both are filled in.',
    });
    desc.style.fontSize   = '13px';
    desc.style.opacity    = '0.75';
    desc.style.marginTop  = '-6px';

    new Setting(containerEl)
      .setName('OAuth client ID')
      .addText(text => text
        .setPlaceholder('....apps.googleusercontent.com')
        .setValue(this.plugin.pluginData.googleClientId ?? '')
        .onChange(async value => {
          this.plugin.pluginData.googleClientId = value.trim();
          await this.plugin.savePluginData();
        }));

    new Setting(containerEl)
      .setName('OAuth client secret')
      .setDesc('Reload the dashboard view after changing either field.')
      .addText(text => {
        text.inputEl.type = 'password';
        return text
          .setPlaceholder('GOCSPX-...')
          .setValue(this.plugin.pluginData.googleClientSecret ?? '')
          .onChange(async value => {
            this.plugin.pluginData.googleClientSecret = value.trim();
            await this.plugin.savePluginData();
          });
      });
  }
}
