/**
 * Date parsing and line parsing.
 *
 * Everything here is a pure function: no Obsidian API, no side effects.
 * That keeps the tricky date logic in one place and easy to reason about.
 */

/** Locale used for the human-readable labels. Change this one line to re-locale. */
const LOCALE = 'en-GB';

/** Matches a bare ISO date anywhere in a line, e.g. 2026-09-03. */
export const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

/** A date the suggester can offer to insert. */
export interface DateOption {
	/** The text we insert into the note, e.g. "2026-09-03". */
	iso: string;
	/** Short name shown in the popup, e.g. "Tomorrow". */
	label: string;
	/** Full date shown next to the label, e.g. "Thu, 4 Sep 2026". */
	detail: string;
}

/* -------------------------------------------------------------------------- */
/* Core date helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Formats a Date as YYYY-MM-DD using the LOCAL calendar day.
 *
 * We deliberately do NOT use toISOString(). That converts to UTC first, so for
 * anyone west of UTC "today" late in the evening comes out as tomorrow's date.
 * Reading the local year/month/day fields avoids the whole problem.
 */
export function toIso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Turns YYYY-MM-DD into a local Date at midnight, or null if the date is not real.
 *
 * The round-trip check is what rejects nonsense like 2026-13-45 or 2026-02-30.
 * JavaScript silently rolls those over (30 Feb becomes 2 Mar), so we build the
 * Date and then confirm it still holds the numbers we asked for.
 */
export function fromIso(iso: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);

	const date = new Date(year, month - 1, day);
	const rolledOver =
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day;

	return rolledOver ? null : date;
}

/**
 * Adds days to a date and returns a new Date.
 * The Date constructor normalises overflow for us, so day 32 of September
 * correctly becomes 2 October, including across month and year boundaries.
 */
export function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Adds months to a date, clamping the day so 31 Jan + 1 month is 28 Feb,
 * not 3 March. Without the clamp the Date constructor would roll over.
 */
export function addMonths(date: Date, months: number): Date {
	const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
	const lastDayOfTargetMonth = new Date(
		target.getFullYear(),
		target.getMonth() + 1,
		0,
	).getDate();
	target.setDate(Math.min(date.getDate(), lastDayOfTargetMonth));
	return target;
}

/** The first day of the month a date falls in. */
export function firstOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Weekday names across the top of the sidebar grid. The week starts on Monday. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The same days, cut to one letter, for the narrow picker in the popup. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Returns every cell of a month grid, in order, including the leading and
 * trailing days from the neighbouring months that fill the first and last rows.
 *
 * getDay() returns 0 for Sunday. Shifting by 6 and taking the remainder turns
 * it into a Monday-first index, so the first row lines up. We then draw whole
 * weeks only: enough rows to cover the month, and no empty row after it.
 */
export function monthGridDates(month: Date): Date[] {
	const start = firstOfMonth(month);
	const leadingBlanks = (start.getDay() + 6) % 7;
	const gridStart = addDays(start, -leadingBlanks);
	const daysInMonth = new Date(
		start.getFullYear(),
		start.getMonth() + 1,
		0,
	).getDate();
	const cellCount = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

	const cells: Date[] = [];
	for (let offset = 0; offset < cellCount; offset++) {
		cells.push(addDays(gridStart, offset));
	}
	return cells;
}

/** Midnight today, in local time. */
export function startOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** True if two dates fall on the same local calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
	return toIso(a) === toIso(b);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                 */
/* -------------------------------------------------------------------------- */

/** "Thu, 4 Sep 2026" */
export function formatLong(date: Date): string {
	return date.toLocaleDateString(LOCALE, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
}

/** "Thursday, 4 September 2026" — used as the day-view heading. */
export function formatHeading(date: Date): string {
	return date.toLocaleDateString(LOCALE, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});
}

/** "September 2026" — used as the picker's month title. */
export function formatMonth(date: Date): string {
	return date.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

/** "Saturday 5 Sep" — the date heading in the upcoming list. */
export function formatDayHeading(date: Date): string {
	return date.toLocaleDateString(LOCALE, {
		weekday: 'long',
		day: 'numeric',
		month: 'short',
	});
}

/** "Sep" — the short month name, for the sidebar title. */
export function formatMonthShort(date: Date): string {
	return date.toLocaleDateString(LOCALE, { month: 'short' });
}

/** "2026" — the year, shown next to the short month name. */
export function formatYear(date: Date): string {
	return String(date.getFullYear());
}

/* -------------------------------------------------------------------------- */
/* The "@" query                                                              */
/* -------------------------------------------------------------------------- */

/** Keywords that resolve to a fixed offset from today. */
const KEYWORDS: ReadonlyArray<{ word: string; offset: number }> = [
	{ word: 'today', offset: 0 },
	{ word: 'tomorrow', offset: 1 },
	{ word: 'yesterday', offset: -1 },
];

/**
 * Matches a relative offset such as +3d, +1w, +2m, or the negative forms.
 * The sign is optional, so "3d" works as well as "+3d".
 */
const OFFSET_RE = /^([+-]?)(\d{1,3})\s*([dwm])$/;

/** Weekday names, in the order JavaScript's getDay() uses (Sunday is 0). */
const WEEKDAYS = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
] as const;

/**
 * Finds the next time a weekday comes round, always in the future.
 *
 * Typing @monday on a Monday gives the Monday a week away, not today. If you
 * mean today, @today says so plainly, and a weekday name that quietly resolves
 * to today is the kind of thing you only notice after the deadline passes.
 */
function nextWeekday(weekdayIndex: number, today: Date): Date {
	const daysAhead = (weekdayIndex - today.getDay() + 7) % 7;
	return addDays(today, daysAhead === 0 ? 7 : daysAhead);
}

/**
 * Resolves one typed query into a single date, or null if it does not parse.
 * Handles the literal ISO form and the relative offsets. Keywords are handled
 * separately in buildSuggestions, because those match on a prefix.
 */
export function parseExactQuery(query: string, today: Date): DateOption | null {
	const q = query.trim().toLowerCase();
	if (q.length === 0) return null;

	// A full literal date, e.g. @2026-09-03.
	const literal = fromIso(q);
	if (literal) {
		return { iso: toIso(literal), label: formatLong(literal), detail: '' };
	}

	// A relative offset, e.g. @+3d or @+1w.
	const offset = OFFSET_RE.exec(q);
	if (offset) {
		const sign = offset[1] === '-' ? -1 : 1;
		const amount = sign * Number(offset[2]);
		const unit = offset[3];

		let date: Date;
		if (unit === 'd') date = addDays(today, amount);
		else if (unit === 'w') date = addDays(today, amount * 7);
		else date = addMonths(today, amount);

		return { iso: toIso(date), label: describeOffset(amount, unit), detail: formatLong(date) };
	}

	return null;
}

/** Turns an offset back into words, e.g. "In 3 days" or "3 weeks ago". */
function describeOffset(amount: number, unit: string | undefined): string {
	const names: Record<string, string> = { d: 'day', w: 'week', m: 'month' };
	const name = names[unit ?? 'd'] ?? 'day';
	const size = Math.abs(amount);
	const plural = size === 1 ? name : `${name}s`;
	return amount < 0 ? `${size} ${plural} ago` : `In ${size} ${plural}`;
}

/**
 * Builds the list shown in the "@" popup for what the user has typed so far.
 *
 * Empty query  -> today, tomorrow, then the next five days by weekday name.
 * Typed query  -> any exact match first, then keyword prefix matches.
 * No match     -> empty list, which closes the popup.
 */
export function buildSuggestions(query: string, today: Date): DateOption[] {
	const q = query.trim().toLowerCase();
	const options: DateOption[] = [];

	if (q.length === 0) {
		options.push(keywordOption('today', 0, today));
		options.push(keywordOption('tomorrow', 1, today));
		for (let offset = 2; offset <= 6; offset++) {
			const date = addDays(today, offset);
			options.push({
				iso: toIso(date),
				label: date.toLocaleDateString(LOCALE, { weekday: 'long' }),
				detail: formatLong(date),
			});
		}
		return options;
	}

	const exact = parseExactQuery(q, today);
	if (exact) options.push(exact);

	for (const keyword of KEYWORDS) {
		if (keyword.word.startsWith(q)) {
			options.push(keywordOption(keyword.word, keyword.offset, today));
		}
	}

	// Weekday names, e.g. @mon, @monday, @thu.
	for (let index = 0; index < WEEKDAYS.length; index++) {
		const name = WEEKDAYS[index];
		if (!name || !name.startsWith(q)) continue;
		const date = nextWeekday(index, today);
		options.push({
			iso: toIso(date),
			label: name.charAt(0).toUpperCase() + name.slice(1),
			detail: formatLong(date),
		});
	}

	// Drop duplicates, keeping the first (and therefore best) match for a date.
	const seen = new Set<string>();
	return options.filter((option) => {
		if (seen.has(option.iso)) return false;
		seen.add(option.iso);
		return true;
	});
}

function keywordOption(word: string, offset: number, today: Date): DateOption {
	const date = addDays(today, offset);
	return {
		iso: toIso(date),
		label: word.charAt(0).toUpperCase() + word.slice(1),
		detail: formatLong(date),
	};
}

/* -------------------------------------------------------------------------- */
/* Line parsing (used by the vault scan)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns every valid ISO date found in a line, in order, without duplicates.
 * Invalid dates such as 2026-13-45 are dropped by the fromIso round-trip check,
 * so a version number like 2026-99-99 never lands on the calendar.
 */
export function findIsoDates(line: string): string[] {
	const found: string[] = [];
	// The regex is global, so reset lastIndex before each line to avoid the
	// classic bug where a shared global regex skips matches on the next call.
	ISO_DATE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = ISO_DATE_RE.exec(line)) !== null) {
		const iso = match[0];
		if (fromIso(iso) && !found.includes(iso)) found.push(iso);
	}
	return found;
}

/**
 * What a date on a line means.
 *   by    — the deadline, written as (by:: 2026-09-24)
 *   plain — the day itself, written as a bare date
 *
 * There is no "when" kind. A bare date already means "this is the day", so a
 * (when:: …) field would cost markup and change nothing you can see.
 */
export type DateKind = 'by' | 'plain';

/** One date found on a line, with the meaning it carries. */
export interface DatedField {
	iso: string;
	kind: DateKind;
	/**
	 * The inline field the date came from, lowercased: "released", "by",
	 * "staged". Null when the date was written bare, with no field around it.
	 */
	field: string | null;
}

/** Opens an inline field: "(", a key, then "::". */
const FIELD_OPEN_RE = /^\(\s*([A-Za-z][\w-]*)\s*::/;

/** Field keys that mean "this is the deadline". */
const DEADLINE_FIELDS = new Set(['by', 'due', 'deadline']);

/** Where one inline field sits on a line, and what its key is. */
interface FieldSpan {
	key: string;
	start: number;
	end: number;
}

/**
 * Finds every inline field on a line: (released:: 2026-08-12), (by:: …),
 * (pr:: [PR #88](https://…)) and so on.
 *
 * A regex cannot do this properly, because a field can hold a markdown link
 * and that link brings its own brackets, so "[^)]*" would stop at the first
 * ")" inside a URL. This walks the line and counts bracket depth instead, so
 * each field is found whole.
 */
function inlineFieldSpans(line: string): FieldSpan[] {
	const spans: FieldSpan[] = [];
	let index = 0;

	while (index < line.length) {
		if (line[index] === '(') {
			const open = FIELD_OPEN_RE.exec(line.slice(index));
			if (open) {
				let depth = 0;
				let scan = index;
				for (; scan < line.length; scan++) {
					if (line[scan] === '(') depth++;
					else if (line[scan] === ')') {
						depth--;
						if (depth === 0) {
							scan++;
							break;
						}
					}
				}
				spans.push({
					key: (open[1] ?? '').toLowerCase(),
					start: index,
					end: scan,
				});
				index = scan;
				continue;
			}
		}
		index++;
	}

	return spans;
}

/**
 * Returns every valid date on a line, each tagged with where it came from.
 *
 * Two passes, because a date does not know what surrounds it:
 *   1. Find the inline fields and note where each one starts and ends.
 *   2. Find the dates. A date inside a field carries that field's key. A date
 *      outside them all has no field.
 *
 * Any key counts, so "released::", "staged::" and "raised::" all work without
 * being listed anywhere. Only the deadline keys change how an item is shown.
 *
 * Invalid dates such as 2026-13-45 are dropped by the fromIso round-trip check,
 * so a version number never lands on the calendar.
 */
export function findDatedFields(line: string): DatedField[] {
	const spans = inlineFieldSpans(line);

	// Keyed by date, so a line never produces two entries for the same day.
	const found = new Map<string, DatedField>();

	// The regex is global, so reset lastIndex before each line to avoid the
	// classic bug where a shared global regex skips matches on the next call.
	ISO_DATE_RE.lastIndex = 0;
	let dateMatch: RegExpExecArray | null;
	while ((dateMatch = ISO_DATE_RE.exec(line)) !== null) {
		const iso = dateMatch[0];
		if (!fromIso(iso)) continue;

		const position = dateMatch.index;
		const span = spans.find((s) => position >= s.start && position < s.end);
		const field = span?.key ?? null;
		const kind: DateKind = field && DEADLINE_FIELDS.has(field) ? 'by' : 'plain';

		// A line can carry the same date twice, for example as a bare date and
		// again as a deadline. Show it once, and keep the stronger meaning: a
		// deadline outranks an ordinary date, and a fielded date outranks a
		// bare one.
		const existing = found.get(iso);
		if (existing?.kind === 'by') continue;
		if (existing && existing.field && !field) continue;
		found.set(iso, { iso, kind, field });
	}

	return [...found.values()];
}

/** Strips the list bullet, the number, and the task checkbox from a line. */
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/;

/**
 * Removes every inline field on a line, whatever its key.
 *
 * "(product:: #elsa-school)" and "(pr:: [PR #88](https://github.com/...))" are
 * metadata, not prose, so neither belongs in a one-line summary. It reuses the
 * same bracket-depth scan that finds the fields in the first place.
 */
function removeInlineFields(line: string): string {
	const spans = inlineFieldSpans(line);
	if (spans.length === 0) return line;

	let result = '';
	let cursor = 0;
	for (const span of spans) {
		result += line.slice(cursor, span.start) + ' ';
		cursor = span.end;
	}
	return result + line.slice(cursor);
}

/**
 * Turns markdown into the words it renders as.
 *
 * The sidebar draws plain text, so raw syntax shows through: a note reading
 * "**Teachers can author** their own" would appear with its asterisks. Each
 * rule keeps the visible words and drops the punctuation around them.
 */
function stripMarkdown(text: string): string {
	return (
		text
			// [[Page|Alias]] shows the alias, [[Page]] shows the page name.
			.replace(/!?\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1')
			.replace(/!?\[\[([^\]]+)\]\]/g, '$1')
			// [PR #88](https://…) shows "PR #88".
			.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
			// `code`, **bold**, *italic*, __bold__, ==highlight==, ~~struck~~.
			.replace(/`([^`]+)`/g, '$1')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/__([^_]+)__/g, '$1')
			.replace(/\*([^*]+)\*/g, '$1')
			.replace(/==([^=]+)==/g, '$1')
			.replace(/~~([^~]+)~~/g, '$1')
	);
}

/**
 * Builds the text we show in the day list.
 *
 * The list is a summary, not the note. So we drop the list marker and the
 * checkbox, every inline field, all markdown syntax, and every date. The day
 * heading already says which day you are looking at, so a date in the text is
 * noise, and a line with two dates reads the same on both days.
 *
 * Text that only looks like a date, such as 2026-13-45, is left alone. It is
 * not a date, so it is part of what the line says.
 */
export function displayText(line: string): string {
	const withoutMarker = line.replace(LIST_MARKER_RE, '');
	const withoutFields = removeInlineFields(withoutMarker);
	const withoutSyntax = stripMarkdown(withoutFields);
	const withoutDates = withoutSyntax.replace(ISO_DATE_RE, (match) =>
		fromIso(match) ? ' ' : match,
	);
	// Collapse the gaps everything above left behind, and tidy punctuation that
	// is now stranded, such as a dangling comma before a full stop.
	const tidied = withoutDates
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.replace(/\(\s*\)/g, '')
		.trim();

	// If the line was nothing but a date, fall back to the raw text so the
	// item is never a blank row.
	return tidied.length > 0 ? tidied : withoutMarker.trim();
}
