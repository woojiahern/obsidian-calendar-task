/**
 * Everything the "@" popup draws.
 *
 * Two things can appear in it: the list of commands while you are still typing
 * the word, and the date picker once a command is settled. This file only
 * draws: it holds no state and decides nothing. The caller owns the state and
 * passes in what to draw plus what to do when something is clicked.
 */

import { setIcon } from 'obsidian';
import { DateCommand } from './commands';
import {
	WEEKDAY_INITIALS,
	addDays,
	formatLong,
	formatMonth,
	isSameDay,
	monthGridDates,
	toIso,
} from './parser';

/** What the picker needs to know to draw itself. */
export interface PickerState {
	/** The month on screen, as its first day. */
	displayMonth: Date;
	/** The highlighted date. Enter accepts this one. */
	focusedDate: Date;
	/** Today, so the grid can mark it. */
	today: Date;
}

/** What the picker does when the user acts. */
export interface PickerHandlers {
	/** A date was chosen. Insert it and close. */
	onPick: (iso: string) => void;
	/** The month arrows were used. */
	onMonthChange: (delta: number) => void;
}

/** The quick buttons above the grid. */
const QUICK_CHOICES: ReadonlyArray<{ label: string; offsetDays: number }> = [
	{ label: 'Today', offsetDays: 0 },
	{ label: 'Tomorrow', offsetDays: 1 },
	{ label: 'Next week', offsetDays: 7 },
];

/**
 * Draws the list of commands the typed word could still become.
 *
 * This is the first thing you see: type "@d" and both "date" and "due" are
 * offered, so the commands are discoverable without being memorised.
 */
export function renderCommandList(
	container: HTMLElement,
	commands: ReadonlyArray<DateCommand>,
	selectedIndex: number,
	today: Date,
	onChoose: (command: DateCommand) => void,
): void {
	container.empty();
	container.addClass('calendar-task-popup');

	const list = container.createDiv({ cls: 'calendar-task-commands' });

	commands.forEach((command, index) => {
		const row = list.createDiv({ cls: 'calendar-task-command' });
		if (index === selectedIndex) row.addClass('is-selected');

		row.createSpan({
			cls: 'calendar-task-command-name',
			text: `@${command.name}`,
		});

		// A command that already knows its day shows that day, so you can see
		// what you are about to insert. The rest just say what they do.
		const resolved = command.resolve?.(today);
		row.createSpan({
			cls: 'calendar-task-command-hint',
			text: resolved ? formatLong(resolved) : command.description,
		});

		onPress(row, () => onChoose(command));
	});
}

export function renderDatePicker(
	container: HTMLElement,
	state: PickerState,
	handlers: PickerHandlers,
): void {
	container.empty();
	container.addClass('calendar-task-popup');
	container.addClass('calendar-task-picker');

	renderQuickRow(container, state, handlers);
	renderMonthHeader(container, state, handlers);
	renderMonthGrid(container, state, handlers);
}

function renderQuickRow(
	parent: HTMLElement,
	state: PickerState,
	handlers: PickerHandlers,
): void {
	const row = parent.createDiv({ cls: 'calendar-task-picker-quick' });

	for (const choice of QUICK_CHOICES) {
		const date = addDays(state.today, choice.offsetDays);
		const button = row.createEl('button', {
			cls: 'calendar-task-picker-quick-button',
			text: choice.label,
		});
		onPress(button, () => handlers.onPick(toIso(date)));
	}
}

function renderMonthHeader(
	parent: HTMLElement,
	state: PickerState,
	handlers: PickerHandlers,
): void {
	const header = parent.createDiv({ cls: 'calendar-task-picker-header' });

	const previous = header.createEl('button', {
		cls: 'calendar-task-picker-nav',
		attr: { 'aria-label': 'Previous month' },
	});
	setIcon(previous, 'chevron-left');
	onPress(previous, () => handlers.onMonthChange(-1));

	header.createDiv({
		cls: 'calendar-task-picker-title',
		text: formatMonth(state.displayMonth),
	});

	const next = header.createEl('button', {
		cls: 'calendar-task-picker-nav',
		attr: { 'aria-label': 'Next month' },
	});
	setIcon(next, 'chevron-right');
	onPress(next, () => handlers.onMonthChange(1));
}

function renderMonthGrid(
	parent: HTMLElement,
	state: PickerState,
	handlers: PickerHandlers,
): void {
	const grid = parent.createDiv({ cls: 'calendar-task-picker-grid' });

	for (const label of WEEKDAY_INITIALS) {
		grid.createDiv({ cls: 'calendar-task-picker-weekday', text: label });
	}

	const monthIndex = state.displayMonth.getMonth();

	for (const date of monthGridDates(state.displayMonth)) {
		const cell = grid.createDiv({
			cls: 'calendar-task-picker-day',
			text: String(date.getDate()),
		});

		if (date.getMonth() !== monthIndex) cell.addClass('is-outside');
		if (isSameDay(date, state.today)) cell.addClass('is-today');
		if (isSameDay(date, state.focusedDate)) cell.addClass('is-focused');

		onPress(cell, () => handlers.onPick(toIso(date)));
	}
}

/**
 * Wires a click without letting the popup's own handlers see it.
 *
 * Two things matter here. preventDefault on mousedown stops the editor losing
 * focus, so the cursor is still in place when we insert the date. Stopping
 * propagation keeps the click from reaching the suggestion popup underneath,
 * which would otherwise treat any click as "accept" and close early.
 */
function onPress(element: HTMLElement, action: () => void): void {
	element.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
	});
	element.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		action();
	});
}
