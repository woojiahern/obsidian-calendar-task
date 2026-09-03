/**
 * DateSuggest — the "@" popup.
 *
 * It has two stages.
 *
 * 1. Commands. Type "@" and all four are offered. Keep typing to narrow them:
 *    "@d" leaves "@date" and "@due".
 *
 * 2. The picker. Once the word is settled, a calendar opens at the cursor.
 *    Click a day, press a quick button, or use the arrow keys and Enter.
 *
 * What gets written depends on the command: "@date" inserts a bare date,
 * "@due" wraps it as "(by:: 2026-09-24)".
 *
 * You can also type the day instead of clicking it. "@date +3d",
 * "@due monday", and "@date 2026-10-15" all move the highlight onto that day.
 */

import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from 'obsidian';
import { COMMANDS, DateCommand, exactCommand, matchingCommands } from './commands';
import {
	addDays,
	addMonths,
	buildSuggestions,
	firstOfMonth,
	fromIso,
	startOfToday,
	toIso,
} from './parser';
import { renderCommandList, renderDatePicker } from './popup';

/**
 * Matches the "@word" the user is typing, ending at the cursor.
 *
 * - (^|[\s(:]) means the "@" must start the line or follow a space, an opening
 *   bracket, or a colon. That keeps the popup out of email addresses, and it
 *   allows the "(by:: @..." form.
 * - [a-z]{0,6} is the command word. It can be empty, so a bare "@" opens the
 *   full list of commands.
 * - The optional tail after a single space is the day you can type instead of
 *   clicking, as in "@due monday".
 */
const TRIGGER_RE = /(?:^|[\s(:])@([a-z]{0,6})(?:\s([^\s@]{0,12}))?$/i;

/** The popup holds one item, and that item is the whole panel. */
const PANEL_ITEM = { kind: 'panel' } as const;
type PanelItem = typeof PANEL_ITEM;

/** Which of the two stages is on screen. */
type Stage = 'commands' | 'picker';

export class DateSuggest extends EditorSuggest<PanelItem> {
	private stage: Stage = 'commands';

	/** Stage 1: the commands on offer, and which one is highlighted. */
	private commands: DateCommand[] = [...COMMANDS];
	private commandIndex = 0;

	/** Stage 2: the command being filled in, and the day highlighted. */
	private activeCommand: DateCommand = COMMANDS[0] as DateCommand;
	private focusedDate: Date = startOfToday();
	private displayMonth: Date = firstOfMonth(startOfToday());

	/** The element the panel is drawn into, so key presses can redraw it. */
	private panelEl: HTMLElement | null = null;

	constructor(app: App) {
		super(app);
	}

	/* ---------------------------------------------------------------------- */
	/* Opening and closing                                                    */
	/* ---------------------------------------------------------------------- */

	/** Decides whether the popup should be open, and what the user has typed. */
	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const textBeforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
		const match = TRIGGER_RE.exec(textBeforeCursor);
		if (!match) return null;

		// A day can only follow a command, so "@ monday" is not a trigger. Without
		// this, writing a sentence after a lone "@" would keep the popup open.
		const hasWord = (match[1] ?? '').length > 0;
		const hasTail = match[2] !== undefined;
		if (!hasWord && hasTail) return null;

		// The whole match minus its leading character, so we know where the "@"
		// sits and can replace everything from it to the cursor.
		const typed = match[0].startsWith('@') ? match[0] : match[0].slice(1);

		return {
			start: { line: cursor.line, ch: cursor.ch - typed.length },
			end: cursor,
			query: typed.slice(1),
		};
	}

	/**
	 * Works out which stage to show. An empty list closes the popup, which is
	 * what we want as soon as the text stops looking like a command.
	 */
	getSuggestions(context: EditorSuggestContext): PanelItem[] {
		// The query is "word" or "word day", split on the single space the
		// trigger allows.
		const spaceAt = context.query.indexOf(' ');
		const word = spaceAt === -1 ? context.query : context.query.slice(0, spaceAt);
		const dayQuery = spaceAt === -1 ? '' : context.query.slice(spaceAt + 1);

		// An exact command that needs a day opens the calendar. "@today" and
		// "@tomorrow" already know their day, so they stay in the list where
		// Enter inserts them in one press.
		const command = exactCommand(word);
		if (command && !command.resolve) {
			this.stage = 'picker';
			this.activeCommand = command;
			return this.preparePicker(dayQuery);
		}

		// Still typing the word, so offer what it could become.
		const options = matchingCommands(word);
		if (options.length === 0) return [];

		this.stage = 'commands';
		this.commands = options;
		this.commandIndex = 0;
		return [PANEL_ITEM];
	}

	/** Points the picker at whatever day the typed tail resolves to. */
	private preparePicker(dayQuery: string): PanelItem[] {
		const today = startOfToday();
		const matches = buildSuggestions(dayQuery, today);

		// Text after the command that is clearly not a day closes the popup,
		// so writing a normal sentence does not leave a calendar on screen.
		if (dayQuery.length > 0 && matches.length === 0) return [];

		const best = matches[0];
		const target = (best ? fromIso(best.iso) : null) ?? today;
		this.focusedDate = target;
		this.displayMonth = firstOfMonth(target);
		return [PANEL_ITEM];
	}

	renderSuggestion(_item: PanelItem, el: HTMLElement): void {
		this.panelEl = el;
		this.draw();
	}

	/** Takes over the keyboard while the popup is open. */
	open(): void {
		super.open();
		document.addEventListener('keydown', this.handleKeyDown, true);
	}

	close(): void {
		document.removeEventListener('keydown', this.handleKeyDown, true);
		this.panelEl = null;
		super.close();
	}

	/* ---------------------------------------------------------------------- */
	/* Drawing                                                                */
	/* ---------------------------------------------------------------------- */

	private draw(): void {
		if (!this.panelEl) return;

		if (this.stage === 'commands') {
			renderCommandList(
				this.panelEl,
				this.commands,
				this.commandIndex,
				startOfToday(),
				(command) => this.chooseCommand(command),
			);
			return;
		}

		renderDatePicker(
			this.panelEl,
			{
				displayMonth: this.displayMonth,
				focusedDate: this.focusedDate,
				today: startOfToday(),
			},
			{
				onPick: (iso) => this.applyDate(iso),
				onMonthChange: (delta) => {
					this.displayMonth = addMonths(this.displayMonth, delta);
					this.draw();
				},
			},
		);
	}

	/**
	 * Acts on a command chosen from the list.
	 *
	 * "@today" and "@tomorrow" already know their day, so they write it and
	 * close. The rest move on to the calendar.
	 *
	 * Moving to the calendar leaves the note untouched. The typed word stays as
	 * it is, and the whole "@..." is replaced in one go when a day is picked.
	 * That keeps the popup's idea of what to replace correct at all times.
	 */
	private chooseCommand(command: DateCommand): void {
		this.activeCommand = command;

		if (command.resolve) {
			this.applyDate(toIso(command.resolve(startOfToday())));
			return;
		}

		this.stage = 'picker';
		this.focusedDate = startOfToday();
		this.displayMonth = firstOfMonth(this.focusedDate);
		this.draw();
	}

	/* ---------------------------------------------------------------------- */
	/* Writing the date                                                       */
	/* ---------------------------------------------------------------------- */

	/** A click on the panel's own padding lands here. */
	selectSuggestion(): void {
		if (this.stage === 'commands') {
			const command = this.commands[this.commandIndex];
			if (command) this.chooseCommand(command);
			return;
		}
		this.applyDate(toIso(this.focusedDate));
	}

	/** Replaces the typed "@..." with the command's text, then closes. */
	private applyDate(iso: string): void {
		const context = this.context;
		if (!context) return;

		const text = this.activeCommand.format(iso);
		context.editor.replaceRange(text, context.start, context.end);
		// Put the cursor straight after what we inserted so typing continues.
		context.editor.setCursor({
			line: context.start.line,
			ch: context.start.ch + text.length,
		});
		this.close();
	}

	/* ---------------------------------------------------------------------- */
	/* Keyboard                                                               */
	/* ---------------------------------------------------------------------- */

	/**
	 * This listens on the document in the capture phase, so it sees the key
	 * before both the editor and Obsidian's own popup handling. Without that,
	 * the arrows would move the text cursor instead of the highlight.
	 *
	 * Escape is left alone, so it still closes the popup.
	 */
	private readonly handleKeyDown = (event: KeyboardEvent): void => {
		const handled =
			this.stage === 'commands'
				? this.handleCommandKey(event.key)
				: this.handlePickerKey(event.key);

		if (!handled) return;
		event.preventDefault();
		event.stopPropagation();
	};

	/** Up and down move through the command list. Enter and Tab choose one. */
	private handleCommandKey(key: string): boolean {
		if (key === 'ArrowUp' || key === 'ArrowDown') {
			const step = key === 'ArrowDown' ? 1 : -1;
			const count = this.commands.length;
			this.commandIndex = (this.commandIndex + step + count) % count;
			this.draw();
			return true;
		}

		if (key === 'Enter' || key === 'Tab') {
			const command = this.commands[this.commandIndex];
			if (command) this.chooseCommand(command);
			return true;
		}

		return false;
	}

	/**
	 * Arrows move a day sideways and a week up or down. PageUp and PageDown
	 * change month. Enter accepts the highlighted day.
	 */
	private handlePickerKey(key: string): boolean {
		if (key === 'Enter') {
			this.applyDate(toIso(this.focusedDate));
			return true;
		}

		const steps: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		const step = steps[key];
		if (step !== undefined) {
			this.moveFocus(step);
			return true;
		}

		if (key === 'PageUp' || key === 'PageDown') {
			this.moveMonth(key === 'PageDown' ? 1 : -1);
			return true;
		}

		return false;
	}

	private moveFocus(days: number): void {
		this.focusedDate = addDays(this.focusedDate, days);
		// Follow the highlight when it walks out of the month on screen.
		this.displayMonth = firstOfMonth(this.focusedDate);
		this.draw();
	}

	private moveMonth(delta: number): void {
		this.focusedDate = addMonths(this.focusedDate, delta);
		this.displayMonth = firstOfMonth(this.focusedDate);
		this.draw();
	}
}
