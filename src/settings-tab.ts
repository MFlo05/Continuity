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
  }
}
