# BoardEase Firebase backend

The mobile app connects directly to Firebase Authentication and Firestore using the Firebase web SDK. This folder contains the security rules and project configuration scaffold for the backend.

## Setup

1. Create a Firebase project and enable Email/Password Authentication and Firestore.
2. Copy `frontend/.env.example` to `frontend/.env` and fill in the Firebase web app values.
3. Apply the rules with the Firebase CLI after signing in:

```sh
firebase deploy --only firestore:rules
```

New accounts receive a regular `user` profile and cannot open the landlord dashboard. Create the account with Firebase Authentication, then promote it with the Firebase Admin SDK:

```sh
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\service-account.json"
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content $env:GOOGLE_APPLICATION_CREDENTIALS -Raw
npm run promote-admin -- admin@example.com
```

The app checks the server-issued `admin` custom claim at login. Client-side profile fields are not trusted for authorization.
