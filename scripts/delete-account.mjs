import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const uid = args[0];
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : undefined; };
const projectId = option("--project");
const expectedEmail = option("--email");
const apply = args.includes("--apply");
if (!uid || !projectId || !expectedEmail) throw new Error("Usage: npm run delete-account -- USER_ID --project PROJECT_ID --email tenant@example.com [--apply]");
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to the project service-account JSON file.");
const app = initializeApp({ credential:applicationDefault(), projectId });
const auth = getAuth(app);
const db = getFirestore(app);
const user = await auth.getUser(uid);
if (user.email?.toLowerCase() !== expectedEmail.toLowerCase()) throw new Error("Email does not match this user ID.");
if (user.customClaims?.admin || user.customClaims?.role === "landlord") throw new Error("This command only deletes tenant accounts.");
const requestRef = db.doc("accountRequests/" + uid);
const request = await requestRef.get();
if (request.data()?.kind !== "deletion" || request.data()?.status !== "pending") throw new Error("A pending tenant deletion request is required.");
const profile = await db.doc("users/" + uid).get();
const rooms = await db.collection("rooms").where("tenantId","==",uid).get();
if (profile.data()?.hasRoom || profile.data()?.roomId || !rooms.empty) throw new Error("Confirm move-out and release the room before deleting this tenant.");
const collections = ["applications","tourRequests","payments","maintenanceRequests","conversations"];
const records = await Promise.all(collections.map(name => db.collection(name).where("tenantId","==",uid).get()));
const notices = await db.collection("notifications").where("recipientId","==",uid).get();
const broadcasts = await db.collection("messages").where("recipientIds","array-contains",uid).get();
console.log(JSON.stringify({ projectId, uid, apply, records:Object.fromEntries(collections.map((name,i) => [name,records[i].size])), notifications:notices.size, broadcasts: broadcasts.size },null,2));
if (!apply) { console.log("Dry run only. Review records and tenancy settlement before repeating with --apply."); process.exit(0); }
// A minimal tombstone blocks existing ID tokens from recreating records during cleanup.
await db.doc("deactivatedAccounts/" + uid).set({ deletedAt:FieldValue.serverTimestamp() },{ merge:true });
await auth.updateUser(uid,{ disabled:true });
await auth.revokeRefreshTokens(uid);
for (const snapshot of records) for (const record of snapshot.docs) await db.recursiveDelete(record.ref);
for (const record of notices.docs) await record.ref.delete();
for (const record of broadcasts.docs) {
  const recipientIds = (record.data().recipientIds || []).filter(id => id !== uid);
  if (recipientIds.length) await record.ref.update({ recipientIds }); else await record.ref.delete();
}
await db.recursiveDelete(db.doc("users/" + uid));
await auth.deleteUser(uid);
await requestRef.delete();
console.log("Tenant account and associated app data deleted. The access-blocking tombstone remains.");
