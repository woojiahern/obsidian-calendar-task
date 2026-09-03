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
	 * Count a date written bare in a line's text, with no field around it.
	 * Off by default: a date mentioned in passing is rarely a plan.
	 */
	countBareDates: boolean;
	/**
	 * Count a date in a heading, which then applies to the list under it.
	 * Off by default, because a daily note titled with its own date would
	 * otherwise sweep every bullet it holds onto that day.
	 */
	countHeadingDates: boolean;
}

export const DEFAULT_SETTINGS: CalendarTaskSettings = {
	excludedFolders: [],
	countBareDates: false,
	countHeadingDates: false,
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
		this.renderSourceToggles();
		this.renderAddControl();
		this.renderExcludedList();
	}

	/**
	 * Where a date is allowed to come from.
	 *
	 * An inline field always counts, so it needs no toggle. The other two
	 * sources are noisier, and which of them is useful depends on how the
	 * vault is written, so each is its own switch.
	 */
	private renderSourceToggles(): void {
		new Setting(this.containerEl)
			.setName('Count bare dates')
			.setDesc(
				'Pick up a date written plainly in a line, with no field around it. Off by default, because it also catches every date mentioned in passing and every [[2026-09-15]] link.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.countBareDates)
					.onChange(async (value) => {
						await this.plugin.setCountBareDates(value);
					}),
			);

		new Setting(this.containerEl)
			.setName('Count dates in headings')
			.setDesc(
				'A dated heading applies to the list directly under it, up to the first blank line. Useful when a heading is a release date. Off by default, because a daily note titled with its own date would sweep in everything it holds — exclude that folder below if you turn this on.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.countHeadingDates)
					.onChange(async (value) => {
						await this.plugin.setCountHeadingDates(value);
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
