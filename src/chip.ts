/**
 * Date chips.
 *
 * Draws every ISO date as a rounded pill, the way Confluence and Google Docs
 * show a date. The text on the page never changes: the chip is styling only,
 * so the date stays plain text you can select, edit, and search.
 *
 * Obsidian renders notes two different ways, so this file does the job twice:
 *   - the editor (Live Preview and Source mode) uses a CodeMirror extension
 *   - Reading view uses a markdown post-processor
 */

import { Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
	Decoration,
	DecorationSet,
	EditorView,
	MatchDecorator,
	ViewPlugin,
	ViewUpdate,
} from '@codemirror/view';
import { fromIso } from './parser';

/** The class both renderers apply. All of the look lives in styles.css. */
const CHIP_CLASS = 'calendar-task-chip';

/** Called with the ISO date when a chip is clicked. */
export type DateClickHandler = (iso: string) => void;

/**
 * Reads the date out of a clicked element, if it was a chip.
 *
 * It searches the chip's text for a date rather than demanding the text be
 * exactly one. A mark decoration can be split or merged by another decoration
 * that overlaps it, so the span may carry a stray space or a neighbouring
 * character, and an exact comparison would quietly fail on a perfectly good
 * chip.
 */
function clickedDate(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	const chip = target.closest(`.${CHIP_CLASS}`);
	if (!chip) return null;
	return firstDateIn(chip.textContent ?? '');
}

/** The first real date in a piece of text, or null if there is none. */
function firstDateIn(text: string): string | null {
	DATE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DATE_RE.exec(text)) !== null) {
		if (fromIso(match[0])) return match[0];
	}
	return null;
}

/**
 * Finds the date sitting under a click, by asking the editor which character
 * was clicked and reading that line's text.
 *
 * This is the reliable route in the editor: it never touches the DOM, so no
 * amount of decoration splitting can confuse it. The chip's own text is only
 * used as a fallback.
 */
function dateAtCoords(view: EditorView, x: number, y: number): string | null {
	const position = view.posAtCoords({ x, y });
	if (position === null) return null;

	const line = view.state.doc.lineAt(position);
	const offset = position - line.from;

	DATE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DATE_RE.exec(line.text)) !== null) {
		const start = match.index;
		const end = start + match[0].length;
		// Allow the very end of the date too, so a click on its right edge
		// still counts.
		if (offset >= start && offset <= end && fromIso(match[0])) return match[0];
	}
	return null;
}

/** Plain ISO date, no capture groups needed here. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

/* -------------------------------------------------------------------------- */
/* Editor (Live Preview and Source mode)                                      */
/* -------------------------------------------------------------------------- */

/**
 * True if a position sits inside code, maths, or the frontmatter block.
 * A date in a code fence is part of the code, so it must not become a chip.
 */
function isInCodeOrFrontmatter(view: EditorView, position: number): boolean {
	let node = syntaxTree(view.state).resolveInner(position, 1);
	while (node.parent) {
		if (/code|math|frontmatter/i.test(node.type.name)) return true;
		node = node.parent;
	}
	return false;
}

/**
 * MatchDecorator handles the fiddly part for us: it finds matches in the lines
 * currently on screen and keeps them in step as the document changes.
 * Returning null from the callback skips a match.
 */
const dateMatcher = new MatchDecorator({
	regexp: DATE_RE,
	decoration: (match, view, position) => {
		// Drop impossible dates such as 2026-13-45, so the chip only ever
		// appears on a date the calendar will actually accept.
		if (!fromIso(match[0])) return null;
		if (isInCodeOrFrontmatter(view, position)) return null;
		// A mark decoration wraps the existing text. It does not replace it, so
		// the cursor and text selection behave exactly as before.
		return Decoration.mark({ class: CHIP_CLASS });
	},
});

const chipDecorations = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = dateMatcher.createDeco(view);
		}

		update(update: ViewUpdate): void {
			this.decorations = dateMatcher.updateDeco(update, this.decorations);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

/**
 * The editor extension: the chips themselves, plus a click handler.
 *
 * The click is not swallowed. The text cursor still lands where you clicked,
 * so a chip behaves like the plain text it is, and the calendar follows along.
 */
export function createDateChipExtension(onDateClick: DateClickHandler): Extension {
	return [
		chipDecorations,
		EditorView.domEventHandlers({
			click: (event, view) => {
				// Ask the editor what was clicked first, and only fall back to
				// reading the chip's own text.
				const iso =
					dateAtCoords(view, event.clientX, event.clientY) ??
					clickedDate(event.target);
				if (iso) onDateClick(iso);
				// false lets the editor handle the click as usual.
				return false;
			},
		}),
	];
}

/* -------------------------------------------------------------------------- */
/* Reading view                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Wraps ISO dates in rendered notes with a chip span.
 *
 * We collect the text nodes first and edit afterwards, because changing the DOM
 * while a TreeWalker is running over it makes the walker miss nodes.
 */
export function renderChipsInReadingView(
	element: HTMLElement,
	onDateClick: DateClickHandler,
): void {
	// One listener on the rendered block, rather than one per chip. It keeps
	// working for chips added by a later pass over the same block.
	element.addEventListener('click', (event) => {
		const iso = clickedDate(event.target);
		if (iso) onDateClick(iso);
	});

	const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];

	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		// Leave code and existing chips alone.
		if (node.parentElement?.closest(`code, pre, .${CHIP_CLASS}`)) continue;
		DATE_RE.lastIndex = 0;
		if (DATE_RE.test(node.nodeValue ?? '')) targets.push(node);
	}

	for (const node of targets) {
		replaceDatesWithChips(node);
	}
}

/** Splits one text node into plain text and chip spans. */
function replaceDatesWithChips(node: Text): void {
	const text = node.nodeValue ?? '';
	const fragment = createFragment();
	let cursor = 0;

	DATE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DATE_RE.exec(text)) !== null) {
		if (!fromIso(match[0])) continue;

		if (match.index > cursor) {
			fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
		}

		fragment.appendChild(createSpan({ cls: CHIP_CLASS, text: match[0] }));

		cursor = match.index + match[0].length;
	}

	// Nothing valid was found, so leave the node untouched.
	if (cursor === 0) return;

	if (cursor < text.length) {
		fragment.appendChild(document.createTextNode(text.slice(cursor)));
	}
	node.replaceWith(fragment);
}
