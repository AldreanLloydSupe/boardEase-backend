# BoardEase Firebase backend

The mobile app connects directly to Firebase Authentication and Firestore using the Firebase web SDK. The normal BoardEase setup uses only Authentication and Firestore, so it works on Firebase's free Spark plan.

The optional `functions/` folder contains a future server-automation version. It is not included in the default Firebase configuration because Cloud Functions require the Blaze plan.

## Setup

1. Create a Firebase project and enable Email/Password Authentication and Firestore.
2. Copy `frontend/.env.example` to `frontend/.env` and fill in the Firebase web app values.
3. Apply the rules with the Firebase CLI after signing in:

```sh
firebase deploy --project boardease-project --only firestore:rules,firestore:indexes
```

The free-plan workflow is client-driven: tenant applications, tour requests, maintenance requests, payment proofs, landlord approval, and status changes are written directly to Firestore by the existing app. Any rent due notice can be calculated when the tenant opens the dashboard instead of using a scheduled function.

If you later choose to enable billing, restore the optional services in `firebase.json` and deploy the automation:

```sh
firebase deploy --project boardease-project --only firestore:rules,firestore:indexes,functions
```

Cloud Storage is also excluded from the free-plan setup. Payment receipts currently use compressed Firestore data, avoiding Storage billing.

New accounts receive a regular `user` profile and cannot open the landlord dashboard. Create the account with Firebase Authentication, then promote it with the Firebase Admin SDK:

```sh
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content $env:GOOGLE_APPLICATION_CREDENTIALS -Raw
npm run promote-admin -- admin@example.com
```

The app checks the server-issued `admin` custom claim at login. Client-side profile fields are not trusted for authorization.
