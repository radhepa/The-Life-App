# Sync your devices

Focus can keep your laptop, phone and tablet in step. There is no account to create and
nothing to host: your data is stored as **one file in a private GitHub repository that you own**,
and each device merges its changes with that file automatically.

- **Free.** Private repositories cost nothing on GitHub.
- **Private.** Only you (and anyone you give the token to) can read the repository. The app
  refuses to connect to a public repository.
- **Recoverable.** Every sync is a commit, so GitHub keeps a full version history you can go back to.
- **Works offline.** Everything is saved on the device first; changes sync when you are back online.

You need a GitHub account. That's all.

---

## Set it up (about five minutes)

### 1. Create a private repository for your data

1. Go to <https://github.com/new>.
2. **Repository name:** anything, for example `focus-data`.
3. Choose **Private**.
4. Tick **Add a README file** (this makes sure the repository has a branch).
5. Click **Create repository**.

### 2. Create an access token

The token is what lets the app read and write that one repository, and nothing else.

1. Open <https://github.com/settings/personal-access-tokens/new> (GitHub → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → *Generate new token*).
2. **Token name:** `Focus sync`.
3. **Expiration:** pick the longest you are comfortable with. When it runs out, the app tells you and you
   create a new one (steps 2 and 3 again).
4. **Repository access:** *Only select repositories* → choose your data repository (`focus-data`).
5. **Permissions → Repository permissions → Contents:** set to **Read and write**.
   (Metadata: Read-only is added for you.)
6. Click **Generate token** and copy it (it starts with `github_pat_`). GitHub shows it only once.

### 3. Connect your first device

Use the device that **already has your data**, usually your laptop.

1. Open Focus → **Settings → Cloud sync**.
2. Open **Set up by hand instead**.
3. **Repository:** `your-github-name/focus-data`. **Access token:** paste the token.
4. Press **Connect**.

The status changes to **Up to date**. Your data is now in the repository.

### 4. Connect your phone

1. **Install the app first** (see [Install on your phone](../README.md#use-it-on-your-phone)). An installed
   app on an iPhone keeps its own separate storage, so set sync up *inside the installed app*, not in Safari.
2. On your first device, open **Settings → Cloud sync → Copy setup code**.
3. Send the code to yourself (Notes, Messages, your password manager…).
   **It contains your token — treat it like a password.**
4. On the phone, open the installed app → **Settings** (under **More**) → **Cloud sync** → paste the code →
   **Connect**.

Your tasks, classes, journal and everything else appear on the phone. From then on, both devices keep
each other up to date.

> **Order matters a little.** Connect the device that has your data first. A brand-new device that connects
> to a repository with data simply adopts it. If you connect two devices that both already hold different data,
> Focus merges them — nothing is thrown away — but it's tidier to start from one.

---

## How syncing behaves

**When it syncs.** A few seconds after you change something, when you open or switch back to the app, when the
connection returns, and once a minute while the app is open. **Settings → Cloud sync → Sync now** does it on demand.

**What is synced.** Classes, tasks, exams, sessions, journeys, journal, sticky notes, bio, settings — everything you
create. **What is not:** a focus timer that is currently running (it belongs to the device it was started on), and
per-device counters.

**Editing on two devices.** Changes are merged task by task and field by field, not file against file:

| You did… | Result |
|---|---|
| Added different tasks on each device | Both are kept |
| Renamed a task on the laptop and ticked it off on the phone | Both changes are kept |
| Changed the *same* field on both | The most recently saved change wins |
| Deleted a task on one device | It is deleted on the other — unless you edited it there, in which case it is kept |

**Safety net.** If a sync would remove most of what a device has (for example, an old copy was restored in the
repository), Focus stops and asks whether to use the cloud copy or keep this device's data. Nothing is deleted
until you choose.

---

## Restore an older version

Because each sync is a commit, you can go back:

1. Open your data repository on GitHub → `focus-data.json` → **History**.
2. Pick the version you want → **⋯ → View file** → **Download raw file**.
3. In Focus: **Settings → Permanent memory → Import JSON** and choose that file.

Focus then pushes the restored version to your other devices.

---

## Troubleshooting

| Message | What to do |
|---|---|
| *That repository is public* | Sync only works with a **private** repository. Make one (step 1) and connect to that. |
| *GitHub rejected the token* | The token is wrong or has expired. Create a new one (step 2) and reconnect. |
| *The token cannot read and write this repo* | Edit the token on GitHub: it needs **Contents: Read and write** on that repository. |
| *That repository was not found, or the token has no access to it* | Check the spelling (`owner/name`) and that the token's *Repository access* includes it. |
| *Offline* | Nothing to do — changes are saved on the device and sync when you are back online. |
| *Paused: the cloud copy would remove…* | Choose **Use the cloud copy** if you meant it, otherwise **Keep this device's data**. |
| Phone shows an empty app after connecting | Make sure you connected inside the *installed* app, then tap **Sync now**. |

**Disconnecting** (Settings → Cloud sync → Disconnect) leaves all data on the device and in the repository; the device
just forgets the token. To revoke access entirely, delete the token on GitHub
(Settings → Developer settings → Personal access tokens).

---

## Good to know

- **Where the token lives.** In the browser's local storage on each device where you connected, and in any setup code
  you copied. Anyone with the token can read and write your data repository, so keep it private and set an expiry.
- **Shared site storage.** On GitHub Pages, every project under `yourname.github.io` shares one browser storage
  area. If you host other sites there, they can read what this app stores. Use a separate GitHub account, or a
  custom domain, if that matters to you.
- **Size.** The whole database is one file. Journal photos are stored inside it, so many large photos make it
  bigger and slower to sync. A few megabytes is comfortable; keep photos modest.
- **Background use on iPhone.** iOS pauses web apps that aren't on screen, so a focus timer can't ring while the
  app is in the background. The time stays correct and is shown when you come back. While a focus block is running,
  the app asks the phone to keep the screen on, where the phone allows it.
