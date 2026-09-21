# Focus

A personal productivity app for focus timing, tasks, habits and journaling. It runs entirely in your
browser — no account, no build step, no dependencies — and can be **installed on your phone** and
**synced between your devices** for free.

| Tab | What it does |
|---|---|
| **Daily** | Today's plan: what's due, what's scheduled, what to do next |
| **Focus** | Focus timer with cycles and breaks, per-session ratings and write-ups |
| **Tasks** | Assignments and exams with due dates, importance, time estimates and subtasks |
| **Journeys** | Habit tracking, on fixed weekdays or "N times a week", with streaks |
| **Journal** | Diary entries with mood and tags, plus reusable prompt templates |
| **Sticky Notes** | Quick notes |
| **Bio** | A structured record of your background, with private entries and one-click exports |
| **Stats** | Focus minutes, completion trends and streaks |
| **History** | Everything you've finished |
| **Settings** | Timer, goals, cloud sync, backup and import/export |

---

## Use it on your phone

**Open the app:** <https://radhepa.github.io/Focus/> (or [host your own copy](#host-your-own-copy)).

It's a web app that installs like a native one — full screen, its own icon, and it opens with no connection.
Nothing is downloaded from an app store.

### iPhone / iPad

1. Open the link in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open Focus from your home screen.

### Android

1. Open the link in **Chrome**.
2. Tap **⋮ → Install app** (or **Add to Home screen**).

### Laptop / desktop

In Chrome or Edge, click the **install** icon in the address bar. Or just keep it as a bookmark.

> **Your data starts empty on each device.** To see the same tasks everywhere, turn on
> [sync](#sync-your-devices). On an iPhone, set sync up *inside the installed app* — it keeps its own
> storage, separate from Safari.

## Sync your devices

Sync keeps your laptop, phone and tablet in step. Your data is stored as one file in a **private GitHub
repository that you own** — free, private, and every sync is a commit, so you get version history for free.
Changes made on different devices are merged, not overwritten.

**Setup, in short:**

1. Create a **private** repository (e.g. `focus-data`) with a README.
2. Create a fine-grained access token limited to that repository, with **Contents: Read and write**.
3. In Focus: **Settings → Cloud sync**, enter the repository and token → **Connect**.
4. On your phone, copy the *setup code* from your first device and paste it into the installed app.

**Full step-by-step guide, how merging works, recovery and troubleshooting: [docs/sync.md](docs/sync.md).**

---

## Run it on your computer

The whole app is `radhe-labs-focus.html`, but a tiny local server lets it save to a file on disk.
You need Python 3 **or** Node.js.

**Windows:** double-click `Start Focus.bat`. It picks Python or Node, starts the server and opens the app.

**Anywhere else:**

```bash
python server.py          # or: node server.js
```

then open <http://127.0.0.1:8765/radhe-labs-focus.html>. Pass a port as the first argument to change it.
The server only ever binds to `127.0.0.1`.

> Open the app through the server, not by double-clicking the HTML file. Opened straight from disk,
> browsers won't keep storage for it and there's nothing behind the page to write your data.

Every change is written to `focus-data.json` next to the app, and a dated safety copy goes to
`focus-data.backup.json` on the first launch of each day. Both are git-ignored, so cloning this repo never
includes anyone's data. Sync works from the local app too.

**Inbox (local server only).** Drop a JSON file of assignments into `inbox.json` and it appears in the app as a
preview; nothing is added until you approve it.

```json
{ "assignments": [] }
```

## Your data and privacy

- **Local server:** `focus-data.json` on your computer.
- **Installed / hosted app:** the browser's own storage on that device.
- **Sync (optional):** one file in *your* private GitHub repository. Nothing goes to any other server.
- The app loads its fonts from Google Fonts when you're online; everything else is local.
- **Settings → Permanent memory** exports everything as JSON or CSV and imports it back.

## Host your own copy

The app is plain static files, so any static host works. On GitHub:

1. **Fork** this repository.
2. In your fork: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. After a minute your copy is at `https://<you>.github.io/<repo>/` — install it on your phone from there.

Your data never touches the repository: it lives in your browser and, if you turn it on, in your own
private sync repository.

## Development

```bash
npm test          # or: node --test        (merge logic, sync engine, service worker)
npm run icons     # regenerate icons/ (needs Python + Pillow)
```

```
radhe-labs-focus.html   the app (markup, styles and logic)
sync-core.js            merge logic and sync engine (no DOM; unit-tested)
sync.js                 sync UI and triggers
sw.js                   service worker: offline support for the installed app
manifest.webmanifest    install metadata
index.html              redirects the site root to the app
server.py / server.js   local server with a save endpoint (either one works)
Start Focus.bat         Windows launcher
icons/, tools/          app icons and the script that generates them
docs/sync.md            sync setup guide
test/                   automated tests
```
