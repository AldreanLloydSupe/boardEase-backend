# BoardEase backend

BoardEase uses Firebase Authentication and Firestore. The React Native app writes applications, tour requests, maintenance conversations, payment proofs, and account review requests directly to Firestore. It stores images as Firestore data URLs and does not use Firebase Storage. `functions/` contains optional Cloud Functions and is intentionally not wired into the deploy config: the app already performs approval/notification workflows, and enabling the triggers would duplicate them. Scheduled Functions also require a billing-enabled project.

## Local setup

Use Node.js 20 or newer, Java 21, and the Firebase CLI installed by `npm install`. Enable Email/Password Authentication and Firestore in the intended Firebase project, then configure the frontend Firebase environment variables separately.

Run the isolated Firestore Emulator tests from this backend directory:

```powershell
npm install
npm run test:rules
```

The tests use `demo-boardease`, the Firestore Emulator on `127.0.0.1:8085`, and the Storage Emulator on `127.0.0.1:9199`; they do not use `.firebaserc` or contact a live project. The emulators need Java 21. `firebase.test.json` is the test-only configuration. The backend `firebase.json` points to paths inside this project. The sibling frontend has a separate Firebase config; do not assume its relative rules or index paths resolve to this directory.

## Project selection and deployment

`.firebaserc` retains `boardease-project` as its existing default alias. Always pass an explicit project ID when using Firebase CLI commands. For a non-production project, deploy only the Firestore rules and indexes with:

```powershell
firebase deploy --project YOUR_NON_PRODUCTION_PROJECT_ID --only "firestore:rules,firestore:indexes"
```

Do not deploy Storage rules or Functions: the app does not use Storage, and its direct Firestore workflows overlap the optional Functions triggers. Reconcile those workflows and review billing before adding either service to a deployment config.

Landlords must have server-issued custom claims. An email address or an editable profile role does not grant management access. Use a service-account credential outside the repository:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
npm run promote-admin -- admin@example.com --project YOUR_NON_PRODUCTION_PROJECT_ID --confirm-project YOUR_NON_PRODUCTION_PROJECT_ID
```

Sign out and sign in again after promotion. From the landlord dashboard, open **Property Settings** and enter the actual caretaker contact, GCash receiver, house rules, and bulletin.

## Free-plan behavior

- Room approval and move-out update the application, user, and actual room document together in a transaction.
- Duplicate submissions use stable per-tenant/per-room or per-reference document IDs.
- Payments begin pending and only management can approve them. Approved records include the room and billing period. Records without a billing period are shown as unallocated rather than silently reducing the current balance.
- Payment receipts are BoardEase acknowledgements, not BIR tax invoices. Downloads use real approved records.
- Small JPG/PNG/WebP images are saved as Firestore data URLs, with a 500,000-character base64 limit (about 375 KB of image data). No Storage bucket is required. Document storage and reads still count toward Firestore quotas.
- Notifications, management messages, and conversations update while the app is open. Reminder timing and category switches are respected. Background push, SMS, and scheduled reminders are not included.
- A 30-day notice records a date; it does not immediately release the tenant's room.
- Legacy duplicate room numbers or mismatched assignments require management review. The app blocks ambiguous assignments instead of creating another room record.

## Account deletion

Tenants submit a deletion request from their profile. Management sees it in Tenants and must finish the tenancy/settlement review and release any room first.

The administrator can review a dry run:

```powershell
npm run delete-account -- USER_ID --project YOUR_NON_PRODUCTION_PROJECT_ID --email tenant@example.com
```

After reviewing the exact account and records, repeat with `--apply --confirm-project YOUR_NON_PRODUCTION_PROJECT_ID`. Applying against the configured production project also requires `--allow-production`. The command disables the account, revokes refresh tokens, deletes associated app data including subcollections, and deletes Authentication. A minimal UID tombstone remains to block existing tokens from recreating data. This command is irreversible; it has not been run against any live account.

## Verification

Install dependencies and Java 21+, then run:

```powershell
npm run lint
npm run test:rules
```

Tests use the isolated `demo-boardease` emulator on port 8085. They do not use the live project. If a previous emulator is still running, stop that test instance before rerunning. The sibling frontend has its own `npm test`, `npm run typecheck`, and `npm run lint` commands; run those from the frontend directory when frontend changes are made.

The optional `functions/` package uses Node.js 20 and has its own dependencies. Its source is retained for review but is not part of the configured deployment.
