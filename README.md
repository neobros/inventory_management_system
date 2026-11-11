# StockPilot — SaaS Inventory & POS

Ships as two apps from one codebase:

| | Runs where | Who uses it |
|---|---|---|
| **Web app** | Browser, hosted | Platform admin — creates and manages shops |
| **Desktop till** | Windows `.exe` | Shop owner, manager, cashier — sells and prints |

Same Firebase project, so a bill rung up on a till shows in the admin panel
immediately. The till is a desktop app for one reason: it prints straight to a
named receipt printer with no dialog. See **[docs/DESKTOP-APP.md](docs/DESKTOP-APP.md)**.

A multi-tenant inventory management and point-of-sale system. React + Vite on the
front end, Firebase (Authentication + Firestore) on the back end. No server to run
and no paid Firebase plan required.

One platform admin creates shops. Each shop gets its own login, its own branding,
its own catalogue, its own bills — completely walled off from every other shop.

---

## What it does

**Platform admin**
- Create a shop and its owner login in one step
- Set each shop's name, logo/icon, currency, receipt paper size and tax rate
- Look up any shop's login, change its password, or email a reset link
- Suspend, reactivate or delete a shop
- Cross-tenant overview: products, bills and 30-day revenue per shop

**Shop owner / manager**
- Products with cost, selling price, stock, reorder point, category, supplier
- A unique CODE128 barcode generated per product, or type in an existing one
- Batch barcode label printing — pick products, set label counts, choose a size, print
- Stock in / stock out / stock-take adjustments, each written to an audit trail
- Sales history with full bill reprint
- Returns, exchanges and cancelled bills — put stock back and print a credit note
- Reports over any date range — presets or a custom from/to — with per-product
  revenue, cost, profit, margin, discounts given and share of sales, plus category
  and payment-method breakdowns, a daily chart, and CSV export
- Staff logins for cashiers and managers, with password lookup and reset
- Shop settings with a live receipt preview and test print

**Cashier**
- Barcode-scanner billing — scan, and the item drops into the bill
- Per-item discount, as a fixed amount or a percentage
- A further discount across the whole bill
- Cash / card / mobile / credit, with change calculation
- Prints to 58mm or 80mm thermal receipt printers, or A4

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
   The free **Spark** plan is enough.
2. **Build → Authentication → Get started → Email/Password → Enable → Save.**
3. **Build → Firestore Database → Create database → Start in production mode →**
   pick the region closest to your shops.
4. **Project settings → General → Your apps → Web (`</>`)** → register an app and
   copy the config values it shows you.

### 3. Paste your keys in

Open **`src/firebase/firebaseConfig.js`** and paste the values from step 2.4 over the
placeholders:

```js
export const firebaseConfig = {
  apiKey: 'AIza...',
  authDomain: 'my-shop.firebaseapp.com',
  projectId: 'my-shop',
  storageBucket: 'my-shop.appspot.com',
  messagingSenderId: '123456789012',
  appId: '1:123456789012:web:abc123',
}
```

That is the only file you edit. There is no `.env` to set up.

### 4. Publish the security rules

Copy the whole of **`firestore.rules`** into **Firestore Database → Rules → Publish**.
Nothing in that file needs changing.

> Skipping this step leaves your database open to the internet. Do not skip it.

### 5. Set the admin login and seed it

Open **`admin.config.js`** and set the email and password you want for the platform
administrator:

```js
export const adminAccount = {
  email: 'admin@yourcompany.com',
  password: 'ChangeMe123!',
  name: 'Super Admin',
}
```

Then run it once:

```bash
npm run seed
```

That creates the login in Firebase Authentication, writes its super-admin profile
and claims the platform:

```
  StockPilot — seeding the platform admin

  • Project : my-shop
  • Admin   : admin@yourcompany.com

  ✓ Created the login in Firebase Authentication
  ✓ Wrote the super-admin profile
  ✓ Claimed the platform (this is now locked to that account)

  Platform admin is ready.
```

The command is safe to re-run — it detects work already done instead of duplicating
it, and if something is not ready yet (rules not published, Email/Password sign-in
still switched off) it tells you exactly which console screen to fix.

### 6. Run

```bash
npm run dev
```

Sign in with the admin account. You land on the **Shops** screen — create your first
shop and hand its login to the shop owner.

**About the super-admin role.** Seeding writes a one-time `platform/bootstrap` marker
that the security rules allow to be created but never changed or deleted. Once it
exists the role is locked, and anyone who signs in later without a shop simply sees
"No shop assigned".

> Need to move the admin role to a different account? In the Firestore console delete
> the `platform` collection **and** the old admin's document in `users`, update
> `admin.config.js`, then run `npm run seed` again.

> `admin.config.js` stores the password in plain text. Change it from **My Account**
> after signing in, or delete the file — it is only needed for that one command.

---

## Daily use

### Billing with a scanner

Most barcode scanners are "keyboard wedge" devices: they type the code and press
Enter, no driver or configuration needed. Open **Billing / POS** — the scan box is
focused automatically, so scanning an item adds it to the bill immediately.

| Key | Action |
| --- | --- |
| `F2` | Jump back to the scan box |
| `F9` | Open checkout |

If a scanner types the code but nothing happens, click the scan box once so the
browser gives it focus.

### Shop logins

**Shops → 🔑 Login** on any row shows that shop's email and password, with copy
buttons, and a **Reset** box that sets a new password immediately. No emails, no
current password needed.

Give the shop the new password — it works straight away.

**How it works.** Firebase stores only a one-way hash, so a password can never be
read back, and the browser can only change the password of whoever is signed in.
Resetting someone else's needs the Firebase Admin SDK, whose key must never reach a
browser. So it runs as a small local service (`server/admin-api.mjs`) that starts
automatically with `npm run dev`. Every request carries your Firebase ID token,
which the service verifies and checks is a super admin before doing anything.

The password you set is also kept in a `shopCredentials` collection — locked by the
security rules to the platform admin alone — so you can look it up later. It is
deliberately not on the shop document, which the shop's own staff can read.

**Shop owners can change their own password** from My Account, and the copy you hold
is updated at the same time so it never goes stale.

**Owners manage their own staff.** Staff Logins shows each cashier's and manager's
password with a show/copy control and a **Reset password** button, stored per shop
under `staffCredentials` and readable only by that shop's owner — a cashier cannot
see a colleague's password.

**One-time setup.** The service needs a service-account key:
Firebase Console → Project settings → **Service accounts** → **Generate new private
key** → save as `serviceAccount.json` in the project root. It is free, stays on your
machine, and is gitignored — never commit it, it grants full project access.

Without that file everything else still runs; only password reset is unavailable,
and the panel says so.

### Returns, exchanges and cancelled bills

**Sales History → ↩ Return** on any bill. Choose how many of each item are coming
back (or **Return whole bill** to cancel it), give a reason, and confirm. Stock goes
back, a credit note prints, and the row is marked **Part returned** or **Cancelled**.

For an **exchange**: return the item, then ring the replacement up as a normal sale.

**The original bill is never edited or deleted.** It is the record of what was
actually charged, and rewriting it would destroy the audit trail — the customer is
also holding a printed copy. A return is written as its own reversing document
instead, exactly as a set of books handles it, and the credit note refers back to the
invoice number. The security rules enforce this: a bill's totals, items, payment and
cashier cannot be changed after it is written, and only the return bookkeeping
(`returnedQty`, `refundedTotal`, `voided`) may ever be added.

Refunds use what the customer **paid** — the line total after discounts, not the list
price — and refund the same proportion of tax, so a return can never hand back more
than was taken. Reports show **net revenue** with a separate **Refunded** figure, and
per-product rows are net of returns.

### Discounts

Discounts are applied in this order, which is what the receipt shows:

```
line totals
  − per-item discounts      (amount or %, per line)
  − whole-bill discount     (amount or %, on what remains)
  + tax                     (on the discounted figure)
  = total
```

A discount can never exceed the line it sits on, and the bill total never goes
below zero.

### Printing bills

Set **Shop Settings → Receipt paper size** to match your printer (58mm, 80mm or A4),
then use **Test print** on that screen to check alignment before your first trading
day. Thermal printers installed as ordinary Windows printers work directly — the app
sets the page size to the paper width and lets the roll run to the length of the bill.

**For one-click printing with no dialog box** — the way a till should behave — there
are two options, and the app tries them in order:

1. **Name your printer.** Install [QZ Tray](https://qz.io/download) on the till, then
   **Shop Settings → Detect printers** and pick your XP-80 from the dropdown. Bills go
   to that exact printer, silently. This is the recommended setup, and the only one
   that lets two tills use different printers.
2. **Kiosk mode.** Open the app with the **`start-pos.bat`** shortcut, which starts
   Chrome in kiosk-printing mode and prints to the Windows default printer. Nothing to
   install.

If neither is set up the app still prints — you just get the usual browser dialog.
Set **Margins: None**, **Scale: 100%**, headers and footers off.

Full walkthrough for the **Xprinter XP-80** and any other model:
**[docs/PRINTER-SETUP.md](docs/PRINTER-SETUP.md)**.

### Printing barcode labels

**Barcode Labels** → set how many stickers each product needs (or hit **Match stock**
to print one per unit in stock) → choose a label size → **Print**.

In the desktop till, **Download A4 PDF** saves the sheet straight to your Downloads
folder — ready to print whenever, on any printer. An **Open folder** link appears
once it is saved. **Print instead** still sends it to a printer directly.

Print label sheets at **100% scale with no margins**. Scaling distorts the bar widths
and scanners will reject them.

---

## Roles

| | Cashier | Manager | Owner | Platform admin |
|---|---|---|---|---|
| Raise bills, reprint | ✅ | ✅ | ✅ | |
| Products & stock | | ✅ | ✅ | |
| Reports & cost prices | | ✅ | ✅ | |
| Shop settings & branding | | ✅ | ✅ | ✅ |
| Staff logins | | | ✅ | |
| Create & suspend shops | | | | ✅ |

---

## Data model

```
platform/bootstrap              write-once marker naming the super admin
users/{uid}                     role, shopId, active — the tenant key for every rule
shops/{shopId}                  name, logo, currency, paperSize, taxRate, active
  products/{id}                 name, sku, barcode, cost, price, stock, lowStockAt
  sales/{id}                    invoiceNo, items[], totals, payment, cashier
  movements/{id}                in | out | adjust | sale — the stock audit trail
  categories/{id}
  meta/counters                 invoice number sequence
```

Every read and write is scoped by the `shopId` on the signed-in user's profile, and
that scoping is enforced in `firestore.rules`, not just in the UI.

Two things are deliberately immutable once written: **sales** and **stock movements**.
They are the audit record.

---

## Notes on the implementation

**Bills are atomic.** Saving a sale allocates the invoice number, decrements stock on
every line and writes the bill inside a single Firestore transaction. A failure
part-way through cannot leave stock deducted for a bill that was never saved.

**Logos are stored as data URLs** in the shop document rather than in Cloud Storage,
which needs a billing-enabled project. Images are resized to 256px on upload, so a
logo costs a few KB against Firestore's 1MB document limit.

**Creating a login does not sign you out.** The Firebase client SDK signs you in as
whoever you just created; the app creates staff and shop-owner accounts through a
throwaway secondary app instance so the admin's own session is untouched.

**Barcodes render as SVG, not canvas.** A canvas barcode is rasterised at screen
resolution and prints fuzzy, which is a common reason scanners refuse to read
home-printed labels.

**Gross profit is an estimate.** It uses each product's cost price as it stands today,
because historical cost is not snapshotted onto sale lines. Change a cost price and
past profit figures shift with it.

---

## Deploying

```bash
npm run build
```

Upload `dist/` to any static host — Firebase Hosting, Netlify, Vercel, or plain
shared hosting. Your keys are compiled in from `firebaseConfig.js`, so there is
nothing extra to configure on the host.

(If you would rather keep keys out of a public repo, `firebaseConfig.js` also reads
`VITE_FIREBASE_*` environment variables when they are present, and those win.)

Because it is a single-page app, point all unmatched routes at `index.html`.

---

## Project layout

```
electron/        Desktop till: main process + preload bridge
start-pos.bat    Opens the till in Chrome kiosk-printing mode (web fallback)
docs/
  DESKTOP-APP.md    Building and deploying the shop till
  PRINTER-SETUP.md  Xprinter XP-80 and thermal printer setup
admin.config.js  Platform admin email + password, used by `npm run seed`
server/
  admin-api.mjs     Local service for password reset (starts with `npm run dev`)
scripts/
  seed-admin.mjs    Creates the admin login and claims the platform
  shop-password.mjs Same reset, from the terminal, if you prefer
src/
  firebase/      firebaseConfig.js  <-- paste your Firebase keys here
  components/    Layout, Barcode, Receipt, LabelSheet, shared UI
  context/       AuthContext (session, role, tenant), ToastContext
  pages/         Login, Dashboard, POS, Products, Labels, Stock,
                 Sales, Reports, Staff, Settings, Account, admin/
  services/      Firestore access — shops, products, sales, users
  utils/         cart maths, barcode, print, currency, image resize
  styles/        global.css (design system), print.css (receipts & labels)
firestore.rules  Security rules — publish these
```
