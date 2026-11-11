# StockPilot Till — the desktop app

The shop side ships as a Windows desktop app. The platform admin panel stays on
the web.

| | Runs where | Who signs in |
|---|---|---|
| **Web app** | Browser, hosted | Platform admin — creates and manages shops |
| **Desktop till** | Windows `.exe` on the shop PC | Shop owner, manager, cashier |

Both are the **same codebase and the same Firebase project**. A bill rung up on
the till appears in the web admin immediately.

---

## Why the till is a desktop app

Printing. A browser cannot choose a printer or print without a dialog — that is a
security rule no setting overrides. Electron has no such restriction, so the till:

- prints **silently to the printer you name**, no dialog
- needs **no QZ Tray**, no `start-pos.bat`, no kiosk flag
- sends the **exact page height**, so a 90mm bill uses 90mm of paper
- keeps working after a PC restart with nothing to remember

---

## Building the installer

```bash
npm run electron:build
```

Produces `release/StockPilot-Till-Setup-1.0.0.exe` (about 116 MB) — a normal Windows
installer that creates a desktop shortcut. Give that file to the shop; nothing else
needs installing on their PC.

The first build downloads Electron's packaging tools and takes a few minutes. Later
builds are quick.

> **Why the build stages outside the project.** Packing directly into this folder
> fails on Windows with `EPERM: operation not permitted, rename
> 'release\win-unpacked.tmp'`. Electron unpacks thousands of deeply nested files,
> and under a long path containing spaces the rename gets refused. So
> `scripts/build-installer.mjs` stages in a short directory at the drive root
> (`D:\.stockpilot-build`), then copies just the finished installer into
> `release/` and deletes the staging folder. Set `SP_BUILD_DIR` to stage somewhere
> else.

## Running it during development

Two terminals:

```bash
npm run dev            # terminal 1 — Vite dev server
npm run electron:dev   # terminal 2 — the till, pointed at it
```

Hot reload works as usual.

To run the till against the **built** files instead:

```bash
npm run electron:start
```

That builds the desktop version first, then opens it.

The web and desktop builds go to **different folders** — `dist/` and `dist-desktop/` —
because they are not interchangeable. The web build uses absolute `/assets/` paths,
which under `file://` point at the root of the drive. When both shared `dist/`, a web
build quietly replaced the desktop one and the till opened to an empty window.

---

## Setting up a shop PC

1. Install the **Xprinter XP-80** driver and connect the printer.
   Set the paper size to the **roll / receipt** option — never a fixed
   `80 x 297mm`, or every bill prints on a 297mm page.
   See [PRINTER-SETUP.md](PRINTER-SETUP.md).
2. Run **StockPilot-Till-Setup.exe**.
3. Launch **StockPilot Till** and sign in with the shop login.
4. **Shop Settings → Receipt printer → Detect printers** — the dropdown lists the
   printers Windows knows about. Pick the XP-80.
5. Set **Receipt paper size** to `80mm`, tick **Print straight away**, **Save**.
6. **Test print.** Paper should come out with no dialog.

There is no QZ Tray step. The desktop build reads printers from Windows directly.

---

## What the cashier sees

Scan → **Charge** → **Save & print bill** → paper comes out, screen clears for the
next customer.

`F2` focuses the scanner, `F9` opens checkout.

## Admin signing in to the till

If a platform admin signs in to the desktop app they get a short message pointing
them to the web app. Shop creation and cross-shop reporting are deliberately not
part of the till.

---

## How printing works internally

`printBill()` in `src/utils/print.js` tries three routes and stops at the first
that succeeds:

1. **Desktop** — `window.stockpilot.print()` over IPC. The main process renders
   the receipt in an hidden window and calls
   `webContents.print({ silent: true, deviceName, pageSize })`.
2. **Web + QZ Tray** — silent print to a named printer.
3. **Browser** — the usual print dialog.

So the same build works everywhere; it just prints better on the desktop.

Page height is measured from the rendered receipt before every job and passed
down in microns, which is what keeps the blank tail off the end of short bills.

## Security

`contextIsolation` is on and `nodeIntegration` off. The renderer gets one named
bridge — list printers, print, app info, show error — and no access to the file
system, `child_process`, or raw IPC. External links open in the user's browser
rather than inside the till.

---

## Releasing a new version

Tills update themselves. The admin publishes a version and a download link; every
till checks it on startup and offers the update.

### Publishing

1. Bump `version` in `package.json` (e.g. `1.0.0` -> `1.0.1`)
2. `npm run electron:build`
3. Upload `release/StockPilot-Till-Setup-1.0.1.exe` somewhere that serves the file
   directly, and copy the link
4. Web admin -> **App Updates** -> set the version, paste the link, describe what
   changed -> **Publish**

Next time a till opens it shows the popup. Accepting downloads the installer and
runs it; NSIS replaces the existing install, so the old version is gone.

Tick **Required update** to stop the till being used until it updates. Otherwise the
shop can skip a version, and will not be asked about that same version again.

The link can be changed at any time — tills read it fresh on every launch, so moving
the file somewhere else only means editing this one field.

### Where to host the installer

The link has to return the `.exe` itself. Anything that answers with a web page
makes the till open a browser instead of updating quietly.

| Host | Works |
|---|---|
| **Firebase Hosting** | Best. Free on Spark, direct link, no limits |
| GitHub Releases | Direct link, reliable |
| Google Drive | Works. Use a **file** link shared "anyone with the link". Drive interrupts large files with a virus-scan page; the till reads the confirmation form out of that page and carries on, so the download still happens in-app |

A Drive **folder** link never works and the admin panel rejects it.

Firebase Hosting is three commands:

```bash
npm i -g firebase-tools
firebase login
firebase init hosting      # public dir: "public"
# copy the installer into public/, then:
firebase deploy --only hosting
```

The link is then `https://<project>.web.app/StockPilot-Till-Setup-1.0.1.exe`.

### How the till decides

`UpdateGate` compares the published version with the one in `package.json`,
numerically — so `1.0.10` correctly beats `1.0.9`. The check waits for Firebase to
restore the session first, because reading the release requires a signed-in user.

The downloaded file is checked for a Windows executable header before anything runs,
which catches a login wall or an error page being saved as `.exe`. If a host will not
serve the file even after following its confirmation pages, the link is opened in a
browser rather than leaving the shop with nothing.

---

## Troubleshooting

**"Detect printers" finds nothing** — no printers installed on that PC. Check
Windows Settings → Printers & scanners.

**Prints but with a long blank tail** — driver paper size is set to a fixed
length. Change it to the roll option (see PRINTER-SETUP.md).

**Blank / dark blue window on launch** — the desktop build is missing or was built
for the web. `npm run electron:start` and `npm run electron:build` both rebuild it
correctly. If `dist-desktop/` does not exist at all, the app now says so instead of
showing an empty window.

**Nothing prints and no error** — confirm a printer is chosen in Shop Settings
and saved. With the field empty the till falls back to the Windows default
printer.
