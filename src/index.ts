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
	/** Whether this date is a deadline or an ordinary one. */
	kind: DateKind;
	/** The inline field the date came from, or null if it was written bare. */
	field: string | null;
}

export class TaskIndex {
	private readonly app: App;

	/** date -> items on that date. This is what the calendar reads. */
	private byDate = new Map<string, TaskItem[]>();

	/** file path -> items from that file. Lets us re-index one file cheaply. */
	private byPath = new Map<string, TaskItem[]>();

	/** Bumped on every rebuild, so an older overlapping one knows to stop. */
	private generation = 0;

	/** Files waiting to be re-scanned on the next flush. */
	private readonly pendingPaths = new Set<string>();

	/** Folder paths whose notes are kept off the calendar. */
	private excludedFolders: string[] = [];

	/** When true, a date only counts inside an inline field. */
	private requireInlineField = true;

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

	/** Folders whose notes never reach the calendar. */
	setExcludedFolders(folders: string[]): void {
		this.excludedFolders = folders;
	}

	/** Whether a date needs an inline field around it to count. */
	setRequireInlineField(value: boolean): void {
		this.requireInlineField = value;
	}

	/* ---------------------------------------------------------------------- */
	/* Building the index                                                     */
	/* ---------------------------------------------------------------------- */

	/**
	 * Scans every markdown file. Run at startup, and after a settings change.
	 *
	 * Two things here stop the index doubling up. The scan builds into fresh
	 * maps and swaps them in at the end, so a rebuild never appends onto the
	 * results of another one. And each run takes a generation number: if a
	 * newer rebuild starts while this one is awaiting a file read, this one
	 * drops its work rather than writing stale results over the new ones.
	 *
	 * Both matter because two rebuilds really do overlap at startup, one on
	 * layout ready and one when the metadata cache finishes resolving. Without
	 * this, every item in the vault was indexed twice and showed up twice.
	 */
	async rebuildAll(): Promise<void> {
		const generation = ++this.generation;
		const byDate = new Map<string, TaskItem[]>();
		const byPath = new Map<string, TaskItem[]>();

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.isExcluded(file.path)) continue;

			const items = await this.scanFile(file);
			// A newer rebuild has taken over. Its results are the current ones.
			if (generation !== this.generation) return;
			addTo(byDate, byPath, file.path, items);
		}

		this.byDate = byDate;
		this.byPath = byPath;
		this.onChanged();
	}

	/**
	 * Marks a file as needing a re-scan.
	 *
	 * The paths are collected in a set and flushed together, rather than
	 * debouncing the file itself. A debounced function keeps only the last
	 * arguments it was called with, so editing one note and then another
	 * inside the debounce window would quietly drop the first one.
	 */
	queueFile(file: TFile): void {
		this.pendingPaths.add(file.path);
		this.flushPending();
	}

	/**
	 * Re-scans the queued files. Debounced, because Obsidian fires a cache
	 * event on nearly every keystroke and a burst of scans is wasted work.
	 */
	private readonly flushPending = debounce(
		() => {
			void this.reindexPending();
		},
		300,
		true,
	);

	private async reindexPending(): Promise<void> {
		const paths = [...this.pendingPaths];
		this.pendingPaths.clear();

		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (!file || this.isExcluded(path)) {
				this.removePath(path);
				continue;
			}
			const items = await this.scanFile(file);
			this.removePath(path);
			addTo(this.byDate, this.byPath, path, items);
		}
		this.onChanged();
	}

	private isExcluded(path: string): boolean {
		return this.excludedFolders.some(
			(folder) => path === folder || path.startsWith(`${folder}/`),
		);
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
			// Every date on the line, with the field it came from. When the
			// setting asks for fields only, a bare date is dropped here: it is
			// almost always a mention rather than a plan, and it is what made
			// the calendar noisy on a real vault.
			const allDates = findDatedFields(raw);
			const ownDates = this.requireInlineField
				? allDates.filter((dated) => dated.field !== null)
				: allDates;

			// No date on the line, so inherit the heading's date if there is one.
			// An inherited date has no field around it, so it counts as plain.
			const inherited = inheritedDates.get(lineNumber) ?? null;
			const dates =
				ownDates.length > 0
					? ownDates
					: inherited
						? [{ iso: inherited, kind: 'plain' as const, field: null }]
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
					field: dated.field,
				});
			}
		}

		return items;
	}
}

/**
 * Files one file's items into a pair of maps.
 *
 * It takes the maps as arguments rather than reading the index's own, so a
 * rebuild can assemble a complete set privately and swap it in when it is done.
 */
function addTo(
	byDate: Map<string, TaskItem[]>,
	byPath: Map<string, TaskItem[]>,
	path: string,
	items: TaskItem[],
): void {
	if (items.length === 0) return;
	byPath.set(path, items);
	for (const item of items) {
		const dayItems = byDate.get(item.date) ?? [];
		dayItems.push(item);
		byDate.set(item.date, dayItems);
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
