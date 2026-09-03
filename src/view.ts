/**
 * CalendarView — the right-sidebar panel.
 *
 * A month grid built in plain DOM, with a dot per item on any day that has
 * them. Below the grid sits one of two lists: the week ahead when no day is
 * selected, or a single day's items once you click one. Clicking that day
 * again clears the selection and brings the week back.
 */

import { ItemView, MarkdownView, WorkspaceLeaf, setIcon } from 'obsidian';
import { TaskIndex, TaskItem } from './index';
import {
	WEEKDAY_LABELS,
	addDays,
	addMonths,
	firstOfMonth,
	formatDayHeading,
	formatHeading,
	formatMonthShort,
	formatYear,
	fromIso,
	isSameDay,
	monthGridDates,
	startOfToday,
	toIso,
} from './parser';

export const CALENDAR_VIEW_TYPE = 'calendar-task-view';

/** How far ahead the upcoming list looks: today plus the next six days. */
const UPCOMING_DAYS = 7;

export class CalendarView extends ItemView {
	private readonly index: TaskIndex;

	/** The month currently on screen, held as its first day. */
	private displayMonth: Date;

	/**
	 * The day whose items are listed below the grid, or null for the upcoming
	 * list. Nothing is selected when the panel opens, so the week comes first.
	 */
	private selectedDate: string | null = null;

	constructor(leaf: WorkspaceLeaf, index: TaskIndex) {
		super(leaf);
		this.index = index;
		this.displayMonth = firstOfMonth(startOfToday());
	}

	getViewType(): string {
		return CALENDAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Calendar tasks';
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('calendar-task-view');
		this.render();
	}

	/** Called by the plugin whenever the index changes. */
	refresh(): void {
		this.render();
	}

	/** Jumps the calendar to a day. Clicking a date chip in a note lands here. */
	selectDate(iso: string): void {
		const date = fromIso(iso);
		if (!date) return;

		this.selectedDate = iso;
		this.displayMonth = firstOfMonth(date);
		this.render();
	}

	/* ---------------------------------------------------------------------- */
	/* Rendering                                                              */
	/* ---------------------------------------------------------------------- */

	private render(): void {
		this.contentEl.empty();
		this.renderHeader(this.contentEl);
		this.renderGrid(this.contentEl);
		this.renderList(this.contentEl);
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv({ cls: 'calendar-task-header' });

		// The month and year are separate spans so the year can carry the
		// accent colour on its own.
		const title = header.createDiv({ cls: 'calendar-task-title' });
		title.createSpan({
			cls: 'calendar-task-title-month',
			text: formatMonthShort(this.displayMonth),
		});
		title.createSpan({
			cls: 'calendar-task-title-year',
			text: formatYear(this.displayMonth),
		});

		const controls = header.createDiv({ cls: 'calendar-task-controls' });

		this.createIconButton(controls, 'chevron-left', 'Previous month', () => {
			this.displayMonth = addMonths(this.displayMonth, -1);
			this.render();
		});

		const todayButton = controls.createEl('button', {
			cls: 'calendar-task-today',
			text: 'Today',
		});
		todayButton.addEventListener('click', () => {
			const today = startOfToday();
			this.displayMonth = firstOfMonth(today);
			this.selectedDate = toIso(today);
			this.render();
		});

		this.createIconButton(controls, 'chevron-right', 'Next month', () => {
			this.displayMonth = addMonths(this.displayMonth, 1);
			this.render();
		});
	}

	private createIconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const button = parent.createEl('button', {
			cls: 'calendar-task-nav',
			attr: { 'aria-label': label },
		});
		setIcon(button, icon);
		button.addEventListener('click', onClick);
	}

	private renderGrid(parent: HTMLElement): void {
		const grid = parent.createDiv({ cls: 'calendar-task-grid' });

		for (const label of WEEKDAY_LABELS) {
			grid.createDiv({ cls: 'calendar-task-weekday', text: label });
		}

		const today = startOfToday();
		const monthIndex = this.displayMonth.getMonth();

		for (const date of monthGridDates(this.displayMonth)) {
			const iso = toIso(date);

			const cell = grid.createDiv({ cls: 'calendar-task-day' });
			cell.createSpan({ cls: 'calendar-task-day-number', text: String(date.getDate()) });

			if (date.getMonth() !== monthIndex) cell.addClass('is-outside');
			if (isSameDay(date, today)) cell.addClass('is-today');
			if (iso === this.selectedDate) cell.addClass('is-selected');

			// One dot per item, up to three. Past three the exact count stops
			// meaning anything at this size, and the row would get crowded.
			//
			// Deadline dots are drawn first and coloured red, so a day with a
			// deadline always shows it even when the day is busy. The dots are
			// hidden while the day is selected: the filled circle already says
			// the day has your attention, and dots inside it read as clutter.
			const summary = this.index.summaryOn(iso);
			const shown = Math.min(summary.total, 3);
			if (shown > 0) {
				cell.addClass('has-items');
				const dots = cell.createDiv({ cls: 'calendar-task-dots' });
				for (let dot = 0; dot < shown; dot++) {
					const element = dots.createDiv({ cls: 'calendar-task-dot' });
					if (dot < summary.due) element.addClass('is-due');
				}
			}

			cell.addEventListener('click', () => {
				// Clicking the selected day again clears it, which brings the
				// upcoming list back.
				this.selectedDate = iso === this.selectedDate ? null : iso;
				// Clicking a trailing or leading day jumps to that month too.
				this.displayMonth = firstOfMonth(date);
				this.render();
			});
		}
	}

	/** Below the grid sits either one chosen day, or the week ahead. */
	private renderList(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'calendar-task-daylist' });
		if (this.selectedDate) this.renderDay(section, this.selectedDate);
		else this.renderUpcoming(section);
	}

	/**
	 * The week ahead: today plus the next six days, soonest first.
	 * Days with nothing on them are left out, so the list stays worth reading.
	 */
	private renderUpcoming(section: HTMLElement): void {
		const today = startOfToday();
		let found = false;

		for (let offset = 0; offset < UPCOMING_DAYS; offset++) {
			const date = addDays(today, offset);
			const items = this.index.getItemsOn(toIso(date));
			if (items.length === 0) continue;

			found = true;
			section.createDiv({
				cls: 'calendar-task-daylist-heading',
				text: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDayHeading(date),
			});
			for (const item of items) {
				this.renderItem(section, item);
			}
		}

		if (!found) {
			section.createDiv({
				cls: 'calendar-task-empty',
				text: 'Nothing in the week ahead.',
			});
		}
	}

	private renderDay(section: HTMLElement, selected: string): void {
		const date = fromIso(selected);
		if (!date) return;

		section.createDiv({
			cls: 'calendar-task-daylist-heading',
			text: formatHeading(date),
		});

		const items = this.index.getItemsOn(selected);
		if (items.length === 0) {
			section.createDiv({
				cls: 'calendar-task-empty',
				text: 'Nothing on this day.',
			});
			return;
		}

		// Ordinary dates share the top of the list with no label, because the
		// day heading already says which day it is. Only deadlines get called
		// out.
		this.renderGroup(
			section,
			null,
			items.filter((item) => item.kind !== 'by'),
		);
		this.renderGroup(
			section,
			'Due',
			items.filter((item) => item.kind === 'by'),
		);
	}

	/** Draws one section. A group with nothing in it draws nothing at all. */
	private renderGroup(
		parent: HTMLElement,
		label: string | null,
		items: TaskItem[],
	): void {
		if (items.length === 0) return;

		if (label) {
			parent.createDiv({ cls: 'calendar-task-group-label', text: label });
		}
		for (const item of items) {
			this.renderItem(parent, item);
		}
	}

	private renderItem(parent: HTMLElement, item: TaskItem): void {
		const row = parent.createDiv({ cls: 'calendar-task-item' });
		if (item.done) row.addClass('is-done');

		const line = row.createDiv({ cls: 'calendar-task-item-line' });
		line.createSpan({ cls: 'calendar-task-item-text', text: item.text });

		// A deadline gets a flag on the right, so a column of flags reads down
		// the list without pushing the text out of line.
		if (item.kind === 'by') {
			const flag = line.createSpan({ cls: 'calendar-task-flag' });
			setIcon(flag, 'flag');
			flag.setAttribute('aria-label', 'Deadline');
		}
		const source = row.createDiv({ cls: 'calendar-task-item-source' });
		source.createSpan({ text: item.sourceName });

		// Name the field the date came from, so "released" and "staged" on the
		// same day are told apart without opening the note. A deadline is left
		// out: its flag already says what it is.
		if (item.field && item.kind !== 'by') {
			source.createSpan({ cls: 'calendar-task-item-field', text: item.field });
		}

		row.addEventListener('click', () => {
			void this.openItem(item);
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Opening a note at the right line                                       */
	/* ---------------------------------------------------------------------- */

	private async openItem(item: TaskItem): Promise<void> {
		const file = this.app.vault.getFileByPath(item.path);
		if (!file) return;

		// false means reuse the active pane in the main area rather than split.
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { eState: { line: item.line } });

		// Put the cursor on the line as well, so the note opens ready to edit.
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			const position = { line: item.line, ch: 0 };
			view.editor.setCursor(position);
			view.editor.scrollIntoView({ from: position, to: position }, true);
		}
	}
}
