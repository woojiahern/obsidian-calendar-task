# Calendar Task

An Obsidian plugin. Tag a line with a date, then see that line on a sidebar calendar.

## What it does

**Type `@` and a letter** on any line, and the commands appear. There are four:

| Command     | What it writes      | What it does                    |
| ----------- | ------------------- | ------------------------------- |
| `@today`    | `2026-09-03`        | inserts straight away           |
| `@tomorrow` | `2026-09-04`        | inserts straight away           |
| `@date`     | `2026-09-24`        | opens the calendar to pick a day |
| `@due`      | `(by:: 2026-09-24)` | opens the calendar to pick a deadline |

`@t` offers today and tomorrow. `@d` offers date and due. A bare `@` opens
nothing, so email addresses and `@names` are left alone.

`@today` and `@tomorrow` show the date they will insert, and Enter writes it.
`@date` and `@due` open a calendar at the cursor: click a day, press a quick
button, or use the arrow keys and Enter.

You can also type the day instead of clicking it. Each of these moves the
highlight, ready for Enter:

| You type              | You get               |
| --------------------- | --------------------- |
| `@date today`         | today's date          |
| `@due tomorrow`       | tomorrow's date       |
| `@date monday`        | the next Monday       |
| `@due +3d`            | 3 days from today     |
| `@date +1w`           | 1 week from today     |
| `@due 2026-09-24`     | that exact date       |

Arrow keys move a day left and right, a week up and down. PageUp and PageDown
change month. Escape closes the popup.

**Every date renders as a chip** — a rounded pill, like Confluence. The text
underneath never changes, so the date stays plain text you can select and search.
**Click a chip** and the sidebar calendar jumps to that day. In the editor the
text cursor still lands where you clicked, so a chip edits like ordinary text.

**The sidebar calendar** shows a month grid with a dot per item on every day
that has them, up to three. A deadline gets a red dot, drawn first, so a busy
day still shows it. The selected day drops its dots. Click an item to open that
note at that line.

Below the grid sits one of two lists:

- **Nothing selected** — the week ahead. Today plus the next six days, soonest
  first, grouped by date. Days with nothing on them are left out. A deadline
  carries a flag.
- **A day selected** — that day only, with deadlines in their own **Due**
  section.

Click a day to select it. Click the same day again to clear it and go back to
the week ahead.

## Where dates can go

**On the line itself.** Any list line, bullet or task:

```markdown
- [ ] Send the invoice 2026-09-10
```

**Under a heading.** A dated heading covers the list directly under it, so a
daily log needs the date once:

```markdown
## 2026-09-03

- [ ] task 1
- [ ] task 2

Prose here. The blank line above already ended the block.

- [ ] this one has no date
```

The block stops at the first blank line after the list. That keeps the scope
tight: a note titled `# 2026-09-03` covers the list under the title, not every
bullet in the note.

**Twice on one line.** Two dates on a line put it on both days, and the item
reads the same on each. If a bare date and a `by::` land on the same day, the
item appears once, as due.

**As a day and a deadline.** A bare date means "this is the day".
`(by:: …)` marks a deadline, so a line can hold both:

```markdown
- [ ] Ship the first build 2026-09-21 (by:: 2026-09-24)
```

That line appears on both days. The bare date sits with the day's other items,
because the day heading already says which day it is. Deadlines get their own
**Due** section, with a flag on the right of each row.

There is no `when::`. A bare date already says "this is the day", so the field
would cost markup and change nothing you can see. Old notes that use it still
work: the field is stripped from the text, and the date inside counts as an
ordinary date.

Only list lines count — bullets, numbered items, and task checkboxes. A date in
a paragraph is ignored, so ordinary prose never clutters the calendar.

## Build it

`npm run dev` is not a server. It is a watcher that compiles the TypeScript in
`src/` into a single `main.js`, because Obsidian can only load plain JavaScript.

Install once:

```bash
npm install
```

Start the watcher. Leave it running; it rebuilds on every save:

```bash
npm run dev
```

In Obsidian, choose **Open folder as vault** and pick `test-vault` inside this
repo. The plugin is already switched on there. After each rebuild, reload with
`Cmd+R`.

Build once, without the watcher:

```bash
npm run build
```

## Install it in a real vault

Only three files ship: `main.js`, `manifest.json`, and `styles.css`. No Node, no
watcher, no build step on the other machine.

```bash
npm run build
```

Copy those three files into `<your vault>/.obsidian/plugins/calendar-task/`,
then switch the plugin on in **Settings → Community plugins**.

## Publish it

1. Push this folder to a public GitHub repo.
2. Set the version in `manifest.json`, for example `0.1.0`.
3. Create a GitHub release. The tag must be the version with no `v` in front:
   `0.1.0`, not `v0.1.0`.
4. Attach `main.js`, `manifest.json`, and `styles.css` to the release as
   separate files. The auto-generated source zip is not enough.

Other people can now install it with the BRAT plugin by pasting the repo name.

For the community plugin store, open a pull request against
[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
adding an entry to `community-plugins.json`. The Obsidian team reviews it. They
require a public repo, a LICENSE, a README, `manifest.json` at the repo root,
and a release tagged as above. First review usually takes a few weeks.

## The test vault

`test-vault/` is a throwaway vault for testing only. Its plugin folder is a
symlink back to this repo, so a rebuild lands in the vault straight away. Never
point this at a real vault.

The vault is not in git, because that symlink points at its own parent. Recreate
it after a fresh clone:

```bash
mkdir -p test-vault/.obsidian/plugins && ln -sfn ../../.. test-vault/.obsidian/plugins/calendar-task && echo '["calendar-task"]' > test-vault/.obsidian/community-plugins.json
```

Then open `test-vault` in Obsidian with **Open folder as vault**.

## Code map

| File             | Job                                                   |
| ---------------- | ----------------------------------------------------- |
| `src/main.ts`    | Entry point. Wires the pieces and listens for changes  |
| `src/parser.ts`  | Date maths and line parsing. Pure functions            |
| `src/index.ts`   | Scans the vault and keeps the results keyed by date    |
| `src/suggest.ts` | The `@` popup: trigger, state, keyboard                |
| `src/popup.ts`   | Draws the command list and the calendar picker         |
| `src/commands.ts`| The four `@` commands                                  |
| `src/chip.ts`    | Renders dates as chips, in the editor and reading view |
| `src/view.ts`    | The sidebar calendar                                   |
| `styles.css`     | All styling, using Obsidian's theme variables          |
