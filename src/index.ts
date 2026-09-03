/**
 * TaskIndex — the vault scan.
 *
 * Holds every list line in the vault that carries an ISO date, keyed by date,
 * so the calendar can ask "what is on 2026-09-03?" without touching disk.
 */

import { App, TFile, debounce } from 'obsidian';
import { DateKind, displayText, findDatedFields, findIsoDates } from './parser';

export interface TaskItem {
	/** The ISO date this item is filed under. */
	date: string;
	/** Text shown in the day list, cleaned of the bullet and the date. */
	text: string;
	/** Vault path of the note the line came from. */
	path: string;
	/** Note name without the folder or the .md, shown as the source. */
	sourceName: string;
	/** Zero-based line number, used to open the note at the right place. */
	line: number;
	/** True when the line is a task checkbox that is ticked. */
	done: boolean;
	/** Whether this date came from when::, by::, or a bare date. */
	kind: DateKind;
}

export class TaskIndex {
	private readonly app: App;

	/** date -> items on that date. This is what the calendar reads. */
	private byDate = new Map<string, TaskItem[]>();

	/** file path -> items from that file. Lets us re-index one file cheaply. */
	private byPath = new Map<string, TaskItem[]>();

	/** Called after any change, so the view can redraw. */
	private onChanged: () => void = () => undefined;

	constructor(app: App) {
		this.app = app;
	}

	setOnChanged(callback: () => void): void {
		this.onChanged = callback;
	}

	/** All items on one day, sorted with unfinished work first. */
	getItemsOn(date: string): TaskItem[] {
		const items = this.byDate.get(date) ?? [];
		return [...items].sort((a, b) => {
			if (a.done !== b.done) return a.done ? 1 : -1;
			return a.path.localeCompare(b.path) || a.line - b.line;
		});
	}

	/** True if a day has at least one item. Drives the dots on the month grid. */
	hasItemsOn(date: string): boolean {
		return (this.byDate.get(date)?.length ?? 0) > 0;
	}

	/**
	 * What a day holds, in the two numbers the grid dots need: how many items
	 * in total, and how many of those are deadlines.
	 */
	summaryOn(date: string): { total: number; due: number } {
		const items = this.byDate.get(date) ?? [];
		return {
			total: items.length,
			due: items.filter((item) => item.kind === 'by').length,
		};
	}

	/** Total items held, shown in the empty state and useful when debugging. */
	get size(): number {
		return this.byPath.size;
	}

	/* ---------------------------------------------------------------------- */
	/* Building the index                                                     */
	/* ---------------------------------------------------------------------- */

	/** Scans every markdown file. Run once at startup and after a bulk change. */
	async rebuildAll(): Promise<void> {
		this.byDate.clear();
		this.byPath.clear();

		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const items = await this.scanFile(file);
			this.store(file.path, items);
		}
		this.onChanged();
	}

	/**
	 * Re-indexes one file. Debounced, because Obsidian fires a cache event on
	 * nearly every keystroke and a burst of scans would be wasted work.
	 */
	readonly queueFile = debounce(
		(file: TFile) => {
			void this.reindexFile(file);
		},
		300,
		true,
	);

	private async reindexFile(file: TFile): Promise<void> {
		const items = await this.scanFile(file);
		this.removePath(file.path);
		this.store(file.path, items);
		this.onChanged();
	}

	/** Drops a file from the index, for deletes and for the old path on rename. */
	removePath(path: string): void {
		const existing = this.byPath.get(path);
		if (!existing) return;

		for (const item of existing) {
			const dayItems = this.byDate.get(item.date);
			if (!dayItems) continue;
			const remaining = dayItems.filter((candidate) => candidate.path !== path);
			if (remaining.length > 0) this.byDate.set(item.date, remaining);
			else this.byDate.delete(item.date);
		}
		this.byPath.delete(path);
	}

	private store(path: string, items: TaskItem[]): void {
		if (items.length === 0) return;
		this.byPath.set(path, items);
		for (const item of items) {
			const dayItems = this.byDate.get(item.date) ?? [];
			dayItems.push(item);
			this.byDate.set(item.date, dayItems);
		}
	}

	/**
	 * Reads one file and returns its dated list items.
	 *
	 * Two Obsidian APIs do the work here:
	 *
	 * 1. metadataCache.getFileCache(file) tells us which lines are list or task
	 *    lines, whether a checkbox is ticked, and where the headings are.
	 *    Obsidian has already parsed the markdown, so we never write a parser.
	 *
	 * 2. vault.cachedRead(file) gives us the text of those lines. cachedRead is
	 *    the right call for a read-only pass: it serves Obsidian's own cache
	 *    instead of hitting the disk again.
	 *
	 * A list item takes its date from the line itself. If the line has no date,
	 * it falls back to the date on the heading it sits under.
	 */
	private async scanFile(file: TFile): Promise<TaskItem[]> {
		const cache = this.app.metadataCache.getFileCache(file);
		const listItems = cache?.listItems;
		// No list items means nothing for us to file. Skip the read entirely.
		if (!listItems || listItems.length === 0) return [];

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const inheritedDates = buildInheritedDates(cache?.headings ?? [], lines);
		const items: TaskItem[] = [];

		for (const listItem of listItems) {
			const lineNumber = listItem.position.start.line;
			const raw = lines[lineNumber];
			// The cache can lag the file by a moment after an edit. If the line
			// is gone, skip it; the next cache event will bring us back here.
			if (raw === undefined) continue;

			// A line is filed under every date it contains, each tagged with what
			// the date means. One line carrying a when:: date and a by:: date
			// appears on both days, in the matching section.
			const ownDates = findDatedFields(raw);

			// No date on the line, so inherit the heading's date if there is one.
			// An inherited date has no field around it, so it counts as plain.
			const inherited = inheritedDates.get(lineNumber) ?? null;
			const dates =
				ownDates.length > 0
					? ownDates
					: inherited
						? [{ iso: inherited, kind: 'plain' as const }]
						: [];

			for (const dated of dates) {
				items.push({
					date: dated.iso,
					text: displayText(raw),
					path: file.path,
					sourceName: file.basename,
					line: lineNumber,
					// listItem.task is the character inside the brackets: a space
					// for an open task, anything else (usually "x") for a done one.
					done: listItem.task !== undefined && listItem.task !== ' ',
					kind: dated.kind,
				});
			}
		}

		return items;
	}
}

/* -------------------------------------------------------------------------- */
/* Heading dates                                                              */
/* -------------------------------------------------------------------------- */

/** The shape we need from Obsidian's heading cache. */
type HeadingCache = {
	heading: string;
	position: { end: { line: number } };
};

/** A line that starts a list item: a bullet, or a number. */
const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** A line that continues the item above it, such as wrapped text. */
const CONTINUATION_RE = /^\s+\S/;

/**
 * Works out which lines inherit a date from a heading above them.
 *
 * A dated heading covers the list directly under it, and stops at the first
 * blank line. Nothing further down the note is touched:
 *
 *   ## 2026-09-03
 *                      <- blank lines between the heading and the list are fine
 *   - [ ] task 1       <- inherits 2026-09-03
 *   - [ ] task 2       <- inherits 2026-09-03
 *                      <- the blank line ends the block
 *   Some prose.
 *   - [ ] task 3       <- no date, so it never reaches the calendar
 *
 * Keeping the scope this tight matters. A note titled "# 2026-09-03" would
 * otherwise sweep every bullet in the whole note onto that one day, including
 * reference notes that were never tasks.
 *
 * This reads the raw lines rather than Obsidian's list positions. Those
 * positions can cover more than the item's own line, which quietly stretched
 * the block past the blank line it was meant to stop at.
 */
export function buildInheritedDates(
	headings: ReadonlyArray<HeadingCache>,
	lines: string[],
): Map<number, string> {
	const inherited = new Map<number, string>();

	for (const heading of headings) {
		const date = findIsoDates(heading.heading)[0];
		if (!date) continue;

		let line = heading.position.end.line + 1;

		// Step over the blank lines that usually sit under a heading.
		while (line < lines.length && (lines[line] ?? '').trim() === '') line++;

		// Then take the run of list lines. It ends at the first line that is
		// neither a list item nor a continuation of one: a blank line, a
		// paragraph, or the next heading.
		while (line < lines.length) {
			const text = lines[line] ?? '';
			if (!LIST_LINE_RE.test(text) && !CONTINUATION_RE.test(text)) break;
			inherited.set(line, date);
			line++;
		}
	}

	return inherited;
}
