/**
 * Settings: which folders the calendar should ignore.
 *
 * A vault usually holds folders whose dated lines are not work — archives,
 * templates, meeting notes, daily logs. Excluding them keeps the calendar
 * about the things you actually plan to do.
 */

import { App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type CalendarTaskPlugin from './main';

export interface CalendarTaskSettings {
	/** Vault-relative folder paths whose notes never reach the calendar. */
	excludedFolders: string[];
	/**
	 * When true, only dates written inside an inline field count, such as
	 * (released:: 2026-08-12). A bare date sitting in the text is ignored.
	 */
	requireInlineField: boolean;
}

export const DEFAULT_SETTINGS: CalendarTaskSettings = {
	excludedFolders: [],
	requireInlineField: true,
};

/**
 * True if a file sits in one of the excluded folders.
 *
 * The check is a path prefix, so excluding "Archive" also excludes
 * "Archive/2025/Q3". The trailing slash matters: without it "Archive" would
 * also match a sibling folder called "Archived".
 */
export function isExcluded(path: string, excludedFolders: string[]): boolean {
	return excludedFolders.some(
		(folder) => path === folder || path.startsWith(`${folder}/`),
	);
}

export class CalendarTaskSettingTab extends PluginSettingTab {
	private readonly plugin: CalendarTaskPlugin;

	constructor(app: App, plugin: CalendarTaskPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();
		this.renderFieldToggle();
		this.renderAddControl();
		this.renderExcludedList();
	}

	/** Whether a date needs an inline field around it to count. */
	private renderFieldToggle(): void {
		new Setting(this.containerEl)
			.setName('Only count dates in inline fields')
			.setDesc(
				'A date counts only when it is written as a field, such as (released:: 2026-08-12) or (by:: 2026-08-20). Any field name works. Turn this off to also pick up bare dates written in the text, and dates in headings.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.requireInlineField)
					.onChange(async (value) => {
						await this.plugin.setRequireInlineField(value);
					}),
			);
	}

	/** The picker for adding a folder to the list. */
	private renderAddControl(): void {
		const excluded = this.plugin.settings.excludedFolders;

		// Offer real folders rather than a free text box, so a typo cannot
		// silently exclude nothing.
		const available = this.app.vault
			.getAllFolders()
			.map((folder: TFolder) => folder.path)
			.filter((path) => path.length > 0 && !excluded.includes(path))
			.sort((a, b) => a.localeCompare(b));

		const setting = new Setting(this.containerEl)
			.setName('Excluded folders')
			.setDesc(
				'Notes in these folders never appear on the calendar. Excluding a folder excludes everything inside it.',
			);

		if (available.length === 0) {
			setting.addButton((button) =>
				button.setButtonText('No folders left to exclude').setDisabled(true),
			);
			return;
		}

		let choice: string = available[0] ?? '';

		setting.addDropdown((dropdown) => {
			for (const path of available) dropdown.addOption(path, path);
			dropdown.setValue(choice);
			dropdown.onChange((value) => {
				choice = value;
			});
		});

		setting.addButton((button) =>
			button
				.setButtonText('Exclude')
				.setCta()
				.onClick(async () => {
					await this.plugin.addExcludedFolder(choice);
					this.display();
				}),
		);
	}

	/** One row per excluded folder, each with a way to put it back. */
	private renderExcludedList(): void {
		const excluded = this.plugin.settings.excludedFolders;

		if (excluded.length === 0) {
			this.containerEl.createDiv({
				cls: 'setting-item-description',
				text: 'No folders are excluded, so the whole vault is scanned.',
			});
			return;
		}

		for (const folder of excluded) {
			new Setting(this.containerEl).setName(folder).addExtraButton((button) =>
				button
					.setIcon('x')
					.setTooltip('Stop excluding this folder')
					.onClick(async () => {
						await this.plugin.removeExcludedFolder(folder);
						this.display();
					}),
			);
		}
	}
}
