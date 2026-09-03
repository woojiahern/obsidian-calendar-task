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
import { CALENDAR_VIEW_TYPE, CalendarView } from './view';

export default class CalendarTaskPlugin extends Plugin {
	private index!: TaskIndex;

	/** Guards the one-time rebuild when the metadata cache first settles. */
	private didInitialScan = false;

	async onload(): Promise<void> {
		this.index = new TaskIndex(this.app);
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
		const onDateClick = (iso: string) => {
			void this.showDate(iso);
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

		// A collapsed sidebar has to be opened explicitly. revealLeaf brings the
		// calendar to the front of its sidebar, but it will not slide a shut
		// sidebar open, so clicking a date in a note appeared to do nothing.
		if (this.app.workspace.rightSplit.collapsed) {
			this.app.workspace.rightSplit.expand();
		}

		await this.app.workspace.revealLeaf(leaf);
	}
}
