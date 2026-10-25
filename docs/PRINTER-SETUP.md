# Receipt printer setup — Xprinter XP-80

Goal: cashier clicks once, the bill comes out. No print dialog, no printer picker.

There are two ways to get there. **Option A is the one you want** — it prints to the
printer you choose by name.

---

## Why a setup step is needed at all

A web page cannot pick a printer or print silently on its own. `window.print()`
always opens the dialog, in every browser. It is a deliberate security rule and no
setting in the app can switch it off.

So the app supports a small helper on the till PC that *can* do it.

| | **Option A — QZ Tray** | **Option B — Kiosk mode** |
|---|---|---|
| Prints to | The printer **you name** in Shop Settings | The Windows **default** printer |
| Print dialog | None | None |
| Needs installing | QZ Tray (free) | Nothing |
| Staff open the app with | Any browser | `start-pos.bat` only |
| Two printers from one till | ✅ Yes | ❌ No |

Set up **A**. Keep **B** as the fallback — the app tries A first and quietly falls
back, so a till with neither still prints through the normal dialog.

---

# Option A — QZ Tray (recommended)

## 1. Install the printer in Windows

Install the XP-80 driver from the CD or from
[xprintertech.com](https://www.xprintertech.com). Connect by USB (or LAN on models
that have a network port) and finish the wizard.

Windows usually names it **XP-80C**, **POS-80** or **Xprinter XP-80C**.

Right-click it → **Printing preferences**:

- **Paper size:** the **roll / receipt** option — named something like
  `80mm x Receipt`, `Roll Paper 80 x 3276mm`, or `80(72.1) x 3276mm` depending on
  driver version
- **Margins:** 0 all round, if the driver offers it

> ⚠️ **Do not pick a fixed length such as `80 x 297mm`.** That tells Windows every
> page is 297mm long, so a short bill prints with a huge blank area and the printer
> feeds out a long tail of paper. The page length must be variable so each bill ends
> where its content ends.

Print a Windows test page to confirm the paper feeds properly.

## 2. Install QZ Tray

Download from **[qz.io/download](https://qz.io/download)** and install on the till
PC. It runs quietly in the system tray and starts with Windows.

> QZ Tray needs Java. The installer bundles it — just accept the defaults.

## 3. Pick your printer in the app

Sign in → **Shop Settings** → *Receipt printer* → **Detect printers**

The first time, QZ shows an **"Allow this site to access printers?"** prompt. Tick
**Remember this decision** and click **Allow**. It will not ask again on this
machine.

The Printer field turns into a dropdown of every printer Windows can see. Choose
your XP-80.

| Setting | Value |
|---|---|
| Receipt paper size | **80mm thermal** |
| Printer | **XP-80C** (from the dropdown) |
| Copies per bill | `1`, or `2` for a merchant copy |
| Print straight away | ✅ ticked |

**Save changes**, then hit **Test print**. Paper should come out with no dialog.

That is it. Billing is now: scan → **Charge** → **Save & print bill** → paper.

---

# Option B — Chrome kiosk mode (no install)

Use this if you cannot install QZ Tray. It prints with no dialog, but always to
whatever printer Windows has set as **default** — you cannot choose per shop.

## 1. Make the XP-80 the default printer

**Settings → Bluetooth & devices → Printers & scanners**

1. Turn **OFF** "Let Windows manage my default printer". This is the step people
   miss — left on, Windows switches the default to whatever was used last and bills
   start going to the office A4 printer.
2. Click the XP-80 → **Set as default**

## 2. Point the launcher at your app

Open **`start-pos.bat`** (in the project folder) in Notepad and set the address
staff will use:

```bat
set "POS_URL=http://localhost:5173"
```

Use your real address if the app is hosted, e.g. `https://mystore.web.app`.

## 3. Open the till with that shortcut

Right-click `start-pos.bat` → **Send to → Desktop (create shortcut)**, rename it
"Till". To launch it at login, press `Win + R`, type `shell:startup`, and drop a
copy of the shortcut there.

Leave the **Printer** field in Shop Settings **empty** for this option.

---

# Troubleshooting

## Still shows the print dialog

**On Option A:** QZ Tray is not running. Check for its icon in the system tray, then
press **Detect printers** in Shop Settings again — it reports whether it connected.
Also confirm the Printer field is not empty and is saved.

**On Option B**, work down this list — it is nearly always the first item:

1. **Chrome was opened normally.** The kiosk flag only applies to the window
   `start-pos.bat` launched. Close *every* Chrome window (check the system tray) and
   start again from the shortcut.
2. **Chrome was already running.** It reuses the existing process and ignores the new
   flag. Fully quit Chrome first.
3. **Don't remove the `--user-data-dir` flag** — the launcher uses a separate profile
   so kiosk printing cannot affect normal browsing.

## Prints to the wrong printer

Option A: check the Printer dropdown in Shop Settings, then **Save changes**.
Option B: Windows changed the default — redo step 1 above.

## Receipt is cut off or too wide

- **Shop Settings → paper size** must match the roll: 80mm for XP-80, 58mm for XP-58
- The driver's paper size must be the roll option, not A4
- On the browser fallback: **Margins: None**, **Scale: 100%**

## Huge blank space above or below the bill

The width is right but the page is far too long. This is the **driver's paper size**
set to a fixed length — go back to step 1 and choose the **roll / receipt** option
instead of `80 x 297mm` or A4.

The app already measures each bill and asks for an exact page height, but the driver
has the final say: if it insists every page is 297mm long, that is what comes out.

Option A (QZ Tray) is far less sensitive to this, because it sends the measured
height directly to the printer rather than going through the browser's page model.

## "Detect printers" finds nothing

QZ Tray is installed but not running, or was blocked. Open it from the Start menu,
check the tray icon appears, and try again. If a firewall prompt appeared during
install, it must be allowed — QZ listens on `localhost:8181`.

## Barcodes on labels will not scan

Print label sheets at **100% scale with margins set to None**. Any scaling changes
the bar widths and scanners reject them. Labels are A4 sheet output — send those to
a normal printer, not the thermal roll.

---

## Other printers

None of this is XP-80 specific. Any printer Windows can see works the same way —
**EPSON TM-T82**, **POS-58**, **Bixolon**, or a plain A4 laser for office-style
bills. Set the matching paper size in **Shop Settings** (58mm / 80mm / A4).

With QZ Tray you can also run **two printers from one till** — receipts to the
thermal, something else to a second printer — because each job names its own
destination.

## Cash drawer

Drawers that plug into the printer's RJ11 port open on the standard ESC/POS kick
pulse. The helper is already in the code (`openCashDrawer` in `src/utils/qz.js`) and
needs QZ Tray. Ask if you want it wired to a button on the billing screen.
