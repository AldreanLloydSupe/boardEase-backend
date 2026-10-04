import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
const email = args[0];
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const projectId = option("--project");
const confirmedProject = option("--confirm-project");
if (!email || !projectId || confirmedProject !== projectId)
  throw new Error("Usage: npm run promote-admin -- admin@example.com --project PROJECT_ID --confirm-project PROJECT_ID [--allow-production]");
if (projectId === "boardease-project" && !args.includes("--allow-production"))
  throw new Error("Refusing the configured production project without --allow-production.");
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS)
  throw new Error(
    "Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account JSON path first.",
  );
const app = initializeApp({ credential: applicationDefault(), projectId });
const user = await getAuth(app).getUserByEmail(email);
await getAuth(app).setCustomUserClaims(user.uid, {
  ...user.customClaims,
  admin: true,
  role: "landlord",
});
console.log(
  `Promoted ${email} to landlord admin in ${projectId}. Sign out and sign in again to refresh the claim.`,
);
