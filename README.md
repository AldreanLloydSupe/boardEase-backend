# BoardEase backend

BoardEase uses Firebase Authentication and Firestore on the Spark plan. The app writes applications, tour requests, maintenance conversations, payment proofs, and account review requests directly to Firestore. Cloud Functions and Firebase Storage are excluded from the deploy configuration.

## Set up and publish rules

Enable Email/Password Authentication and Firestore, then fill in the frontend Firebase environment variables. Deploy from this backend directory:

```powershell
firebase deploy --project boardease-project --only "firestore:rules,firestore:indexes"
```

The backend rules are the deployment source. In this two-repository workspace the frontend Firebase configuration references these files; its rules copy is checked by the emulator tests to prevent drift.

Landlords must have server-issued custom claims. An email address or an editable profile role does not grant management access. Use a service-account credential outside the repository:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
npm run promote-admin -- admin@example.com
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
npm run delete-account -- USER_ID --project boardease-project --email tenant@example.com
```

After reviewing the exact account and records, repeat with `--apply`. The command disables the account, revokes refresh tokens, deletes associated app data including subcollections, and deletes Authentication. A minimal UID tombstone remains to block existing tokens from recreating data. This command is irreversible when applied; it has not been run on any live account as part of these code changes.

## Verification

Install dependencies and Java 21+, then run:

```powershell
npm run test:rules
```

Tests use the isolated `demo-boardease` emulator on port 8085. They do not use the live project. If a previous emulator is still running, stop that test instance before rerunning. The frontend also has `npm test`, `npm run typecheck`, `npm run lint`, and `npx expo export --platform web`.

The optional `functions/` code is a separate future automation path and is not deployed by the Spark configuration.
