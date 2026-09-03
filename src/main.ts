/**
 * Calendar Task — plugin entry point.
 *
 * Wires three pieces together:
 *   suggest.ts  the "@" date popup
 *   index.ts    the vault scan that finds dated list lines
 *   view.ts     the sidebar calendar
 */

import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { createDateChipExtension, renderChipsInReadingView } from './chip';
import { TaskIndex } from './index';
import { DateSuggest } from './suggest';
import {
	CalendarTaskSettingTab,
	CalendarTaskSettings,
	DEFAULT_SETTINGS,
} from './settings';
import { CALENDAR_VIEW_TYPE, CalendarView } from './view';

export default class CalendarTaskPlugin extends Plugin {
	settings: CalendarTaskSettings = { ...DEFAULT_SETTINGS };

	private index!: TaskIndex;

	/** Guards the one-time rebuild when the metadata cache first settles. */
	private didInitialScan = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.index = new TaskIndex(this.app);
		this.index.setExcludedFolders(this.settings.excludedFolders);
		this.index.setOnChanged(() => this.refreshViews());

		this.registerView(
			CALENDAR_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new CalendarView(leaf, this.index),
		);

		const dateSuggest = new DateSuggest(this.app);
		this.registerEditorSuggest(dateSuggest);
		// The popup listens on the document while it is open. Closing it on
		// unload makes sure that listener goes with the plugin.
		this.register(() => dateSuggest.close());

		// Draw dates as chips: the CodeMirror extension covers the editor, the
		// post-processor covers Reading view. Clicking a chip in either one
		// jumps the calendar to that day.
		// Deferred to the next tick on purpose. Obsidian finishes handling the
		// click after us: it puts focus back in the editor and settles the
		// layout, which slams a sidebar shut if we opened it mid-click. Running
		// once the click is over means nothing follows us to undo it.
		const onDateClick = (iso: string) => {
			window.setTimeout(() => {
				void this.showDate(iso);
			}, 0);
		};
		this.registerEditorExtension(createDateChipExtension(onDateClick));
		this.registerMarkdownPostProcessor((element) => {
			renderChipsInReadingView(element, onDateClick);
		});

		this.addRibbonIcon('calendar-days', 'Open task calendar', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-task-calendar',
			name: 'Open task calendar',
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new CalendarTaskSettingTab(this.app, this));

		this.registerVaultEvents();

		// Wait for layout before the first scan: the metadata cache is not
		// populated until Obsidian has finished starting up.
		this.app.workspace.onLayoutReady(() => {
			void this.index.rebuildAll();
			void this.activateView();
		});
	}

	/**
	 * Keeps the index in step with the vault.
	 *
	 * We listen to metadataCache "changed" rather than vault "modify", because
	 * "modify" fires before Obsidian has re-parsed the file. By the time
	 * "changed" fires the list items are current, which is what the scan reads.
	 */
	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.metadataCache.on('changed', (file: TFile) => {
				this.index.queueFile(file);
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				// Fires once the whole vault has been parsed. On a large vault the
				// startup scan can run before that finishes, so we scan again.
				if (this.didInitialScan) return;
				this.didInitialScan = true;
				void this.index.rebuildAll();
			}),
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.index.removePath(file.path);
				this.refreshViews();
			}),
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.index.removePath(oldPath);
				if (file instanceof TFile) this.index.queueFile(file);
				this.refreshViews();
			}),
		);
	}

	/* ---------------------------------------------------------------------- */
	/* Settings                                                               */
	/* ---------------------------------------------------------------------- */

	/**
	 * Reads the saved settings, falling back to the defaults.
	 *
	 * loadData returns whatever is in data.json, which is untyped and could be
	 * anything, so each field is checked rather than trusted.
	 */
	private async loadSettings(): Promise<void> {
		const saved: unknown = await this.loadData();
		const settings: CalendarTaskSettings = { ...DEFAULT_SETTINGS };

		if (saved && typeof saved === 'object' && 'excludedFolders' in saved) {
			const folders: unknown = saved.excludedFolders;
			if (Array.isArray(folders)) {
				settings.excludedFolders = folders.filter(
					(folder): folder is string => typeof folder === 'string',
				);
			}
		}

		this.settings = settings;
	}

	/** Stops scanning a folder, and drops what it already contributed. */
	async addExcludedFolder(folder: string): Promise<void> {
		if (this.settings.excludedFolders.includes(folder)) return;
		this.settings.excludedFolders.push(folder);
		this.settings.excludedFolders.sort((a, b) => a.localeCompare(b));
		await this.applyExclusions();
	}

	/** Starts scanning a folder again. */
	async removeExcludedFolder(folder: string): Promise<void> {
		this.settings.excludedFolders = this.settings.excludedFolders.filter(
			(candidate) => candidate !== folder,
		);
		await this.applyExclusions();
	}

	/**
	 * Saves the folder list and rescans. A full rebuild is the honest way to
	 * apply this: excluding a folder has to remove what it already contributed,
	 * and including one has to pick up everything it holds.
	 */
	private async applyExclusions(): Promise<void> {
		await this.saveData(this.settings);
		this.index.setExcludedFolders(this.settings.excludedFolders);
		await this.index.rebuildAll();
	}

	/** Opens the calendar if needed, then shows the given day. */
	private async showDate(iso: string): Promise<void> {
		await this.activateView();
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof CalendarView) view.selectDate(iso);
		}
	}

	/** Redraws every open calendar panel. */
	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof CalendarView) view.refresh();
		}
	}

	/** Opens the calendar in the right sidebar, or reveals it if already open. */
	private async activateView(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)[0] ?? null;

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false);
			if (!leaf) return;
			// Only a new leaf needs its view set. Doing this to a leaf that is
			// already showing the calendar would tear the view down and rebuild
			// it, losing the day you had selected.
			await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
		}

		await this.app.workspace.revealLeaf(leaf);

		// revealLeaf brings the calendar to the front of its sidebar but will
		// not slide a shut sidebar open, so open it here. This runs after the
		// reveal, because revealing can leave a collapsed sidebar collapsed.
		if (this.app.workspace.rightSplit.collapsed) {
			this.app.workspace.rightSplit.expand();
		}
	}
}
