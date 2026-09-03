# Calendar Task

An Obsidian plugin. Tag a line with a date, then see that line on a sidebar calendar.

## What it does

**Type `@`** on any line and the four commands appear:

| Command     | What it writes      | What it does                    |
| ----------- | ------------------- | ------------------------------- |
| `@today`    | `2026-09-03`        | inserts straight away           |
| `@tomorrow` | `2026-09-04`        | inserts straight away           |
| `@date`     | `2026-09-24`        | opens the calendar to pick a day |
| `@due`      | `(by:: 2026-09-24)` | opens the calendar to pick a deadline |

Keep typing to narrow them: `@t` leaves today and tomorrow, `@d` leaves date
and due. The `@` has to start a line or follow a space, so email addresses are
left alone.

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

The calendar stays put and only the list below it scrolls, so the month is
always in view. Each item is trimmed to a readable summary: inline fields like
`(product:: …)`, markdown links, and formatting are stripped, and long lines
are clamped to two lines.

Below the grid sits one of two lists:

- **Nothing selected** — the week ahead. Today plus the next six days, soonest
  first, grouped by date. Days with nothing on them are left out. A deadline
  carries a flag.
- **A day selected** — that day only, with deadlines in their own **Due**
  section.

Click a day to select it. Click the same day again to clear it and go back to
the week ahead.

## Settings

**Only count dates in inline fields** (on by default). A date counts only when
it is written as a field:

```markdown
- [ ] Shipped the build (released:: 2026-08-12)
- [ ] Review with Thomas (by:: 2026-08-20)
```

Any key works — `released::`, `staged::`, `raised::`, `resolved::` — and each
item shows which field its date came from. `by::`, `due::` and `deadline::` are
the ones that mean a deadline, so they get the flag and the **Due** section.

Turn this off to also pick up bare dates written in the text, and dates in
headings. That is the looser rule, and on a real vault it pulls in a lot: every
`[[2026-09-15]]` daily-note link, every date mentioned in passing, and every
bullet under a daily note's own title.

**Excluded folders.** The rest of the tab is a list of folders to leave out of
the scan.
Pick a folder and the calendar stops showing anything inside it, including its
subfolders. Useful for archives, templates, and anything else whose dates are
history rather than plans.

## Where dates can go

**On the line itself.** Any list line, bullet or task:

```markdown
- [ ] Send the invoice 2026-09-10
```

**Under a heading**, when **Only count dates in inline fields** is off. A dated
heading then covers the list directly under it, so a daily log needs the date
once:

```markdown
## 2026-09-03

- [ ] task 1
- [ ] task 2

Prose here. The blank line above already ended the block.

- [ ] this one has no date
```

The block stops at the first blank line after the list. Even so, a daily note
titled `# 2026-09-15` pulls in the list under its title, which is why headings
only count under the looser rule.

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

Only three files ship: `main.js`, `manifest.json`, and `styles.css`.

A GitHub Action in `.github/workflows/release.yml` does the build. Push a tag
and it compiles the plugin and opens a **draft** release with those three files
attached:

```bash
git tag 0.1.0 && git push origin 0.1.0
```

The tag must match the `version` in `manifest.json` exactly, with no `v` in
front: `0.1.0`, not `v0.1.0`. Publish the draft release on GitHub when you are
ready.

Anyone can then install it with the BRAT plugin by pasting the repo name.

## Submit it to the community directory

1. Make the repo **public**. A private repo cannot be submitted.
2. Publish a release, as above.
3. Go to [community.obsidian.md](https://community.obsidian.md), sign in with
   your Obsidian account, and link your GitHub account.
4. Add the plugin there. Obsidian reads `manifest.json` from the default
   branch.
5. An automated review runs. Fix anything it flags, then publish a new release
   with the version bumped, until it passes.

This replaced the old process of opening a pull request against
`obsidianmd/obsidian-releases`.

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
| `src/settings.ts`| The settings tab and the excluded-folder list          |
| `styles.css`     | All styling, using Obsidian's theme variables          |
