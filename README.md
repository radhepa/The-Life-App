# Focus

A personal productivity and study-tracking app in a single HTML file — no build step, no
dependencies, no account. Everything runs locally and your data stays on your machine.

## What's in it

| Tab | What it does |
|---|---|
| **Daily** | Today's plan: what's due, what's scheduled, what to do next |
| **Focus** | Focus timer with cycles and breaks, per-session ratings and write-ups |
| **Tasks** | Assignments and exams with due dates, importance, time estimates and subtasks |
| **Journeys** | Habit tracking, either on fixed weekdays or "N times a week", with streaks |
| **Journal** | Diary entries with mood and tags, plus reusable prompt templates |
| **Sticky Notes** | Quick notes |
| **Bio** | A structured record of your background — roles, projects, people — with private entries and one-click exports for applications |
| **Stats** | Focus minutes, completion trends and streaks |
| **History** | Everything you've completed |
| **Settings** | Classes, theme, goals, backup and import/export |

## Running it

You need Python 3 **or** Node.js — the app itself is just `radhe-labs-focus.html`, but a tiny
local server is what lets it save to disk instead of relying on browser storage.

**Windows:** double-click `Start Focus.bat`. It picks Python or Node, starts the server and
opens the app.

**Anywhere else:**

```bash
python server.py          # or: node server.js
```

then open <http://127.0.0.1:8765/radhe-labs-focus.html>. Pass a port as the first argument to
change it. The server only ever binds to `127.0.0.1`.

> Open the app through the server, not by double-clicking the HTML file. Opened straight from
> disk, browsers won't keep storage for it and there's nothing behind the page to write your data.

## Your data

Every change is written to `focus-data.json` next to the app — that file is your save.
A dated safety copy goes to `focus-data.backup.json` on the first launch of each day.
Both are git-ignored, so cloning this repo never includes anyone's data. To back up or move
your data, copy `focus-data.json`, or use **Settings → Export JSON** and **Import**.

## Inbox

Drop a JSON file of assignments into `inbox.json` in the app folder and it appears in the app
as a preview; nothing is added until you approve it.

```json
{ "assignments": [] }
```

## Files

```
radhe-labs-focus.html   the whole app
server.py / server.js   local server + save endpoint (either one works)
Start Focus.bat         Windows launcher
```
