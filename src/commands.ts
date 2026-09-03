/**
 * The commands the "@" popup offers.
 *
 * Two kinds. "today" and "tomorrow" resolve to a day on their own, so picking
 * one writes the date straight away. "date" and "due" open the calendar first.
 */

import { addDays } from './parser';

export interface DateCommand {
	/** The word you type after "@". */
	name: string;
	/** One line shown next to the name, when the command has no date to show. */
	description: string;
	/** Turns the chosen date into the text inserted at the cursor. */
	format: (iso: string) => string;
	/**
	 * Set on commands that already know their day. These skip the calendar and
	 * insert as soon as you pick them.
	 */
	resolve?: (today: Date) => Date;
}

export const COMMANDS: ReadonlyArray<DateCommand> = [
	{
		name: 'today',
		description: "Today's date",
		format: (iso) => iso,
		resolve: (today) => today,
	},
	{
		name: 'tomorrow',
		description: "Tomorrow's date",
		format: (iso) => iso,
		resolve: (today) => addDays(today, 1),
	},
	{
		name: 'date',
		description: 'Pick a day',
		format: (iso) => iso,
	},
	{
		name: 'due',
		description: 'Pick a deadline',
		format: (iso) => `(by:: ${iso})`,
	},
];

/** The command whose name is exactly this word, if there is one. */
export function exactCommand(word: string): DateCommand | null {
	return COMMANDS.find((command) => command.name === word.toLowerCase()) ?? null;
}

/** Every command the typed word could still turn into. */
export function matchingCommands(word: string): DateCommand[] {
	const typed = word.toLowerCase();
	return COMMANDS.filter((command) => command.name.startsWith(typed));
}
