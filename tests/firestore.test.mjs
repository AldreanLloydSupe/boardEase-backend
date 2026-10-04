import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
let env;
let alice, bob, applicant, admin;
test("tenant direct chat is private and first message creates one real conversation", async () => {
  await assertSucceeds(getDoc(doc(alice, "conversations", "alice")));
  await assertSucceeds(getDocs(query(collection(alice, "conversations"), where("__name__", "==", "alice"))));
  await assertSucceeds(getDocs(collection(alice, "conversations", "alice", "messages")));
  const batch = writeBatch(alice);
  batch.set(doc(alice, "conversations", "alice"), { tenantId: "alice", tenantName: "Alice", roomNumber: "201", createdAt: serverTimestamp() });
  batch.set(doc(alice, "conversations", "alice", "messages", "first"), { senderId: "alice", senderName: "Alice", body: "Hello management", createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(collection(admin, "conversations")));
  await assertSucceeds(getDocs(collection(admin, "conversations", "alice", "messages")));
  await assertFails(getDoc(doc(bob, "conversations", "alice")));
  await assertFails(getDocs(collection(bob, "conversations", "alice", "messages")));
  await assertFails(updateDoc(doc(alice, "conversations", "alice"), { tenantId: "bob" }));
  await assertSucceeds(setDoc(doc(admin, "conversations", "alice", "messages", "reply"), { senderId: "manager", senderName: "Management", body: "Hello Alice", createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(alice, "conversations", "alice", "readReceipts", "alice"), { readAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(admin, "conversations", "alice", "readReceipts", "manager"), { readAt: serverTimestamp() }));
  await assertFails(getDoc(doc(alice, "conversations", "alice", "readReceipts", "manager")));
});
test("landlord can initiate private tenant chat with validated profile identity", async () => {
  await assertFails(setDoc(doc(admin, "conversations", "alice"), { tenantId: "alice", tenantName: "Alice", roomNumber: "999", createdAt: serverTimestamp() }));
  const batch = writeBatch(admin);
  batch.set(doc(admin, "conversations", "alice"), { tenantId: "alice", tenantName: "Alice", roomNumber: "201", createdAt: serverTimestamp() });
  batch.set(doc(admin, "conversations", "alice", "messages", "first"), { senderId: "manager", senderName: "Management", body: "Hello Alice", createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(collection(alice, "conversations", "alice", "messages")));
  await assertFails(getDocs(collection(bob, "conversations", "alice", "messages")));
});
test("direct chat rejects forged identity, room information, and orphan messages", async () => {
  await assertFails(setDoc(doc(alice, "conversations", "alice"), { tenantId: "alice", tenantName: "Alice", roomNumber: "999", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, "conversations", "bob"), { tenantId: "bob", tenantName: "Bob", roomNumber: "", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, "conversations", "alice", "messages", "orphan"), { senderId: "manager", senderName: "Management", body: "Forged reply", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, "conversations", "alice", "messages", "orphan2"), { senderId: "alice", senderName: "Alice", body: "No parent conversation", createdAt: serverTimestamp() }));
});
test("opening a maintenance chat clears only the viewer unread messages and later replies become unread", async () => {
  const message = (body) => ({senderId: "manager", senderName: "Management", body, createdAt: serverTimestamp()});
  await assertSucceeds(setDoc(doc(admin, "maintenanceRequests", "request-a", "messages", "first"), message("First reply")));
  const unread = async () => {
    const read = await getDoc(doc(alice, "maintenanceRequests", "request-a", "readReceipts", "alice"));
    const messages = await getDocs(collection(alice, "maintenanceRequests", "request-a", "messages"));
    const readAt = read.data()?.readAt?.toMillis() || 0;
    return messages.docs.filter(item => item.data().senderId !== "alice" && item.data().createdAt.toMillis() > readAt).length;
  };
  assert.equal(await unread(), 1);
  await assertSucceeds(setDoc(doc(alice, "maintenanceRequests", "request-a", "readReceipts", "alice"), {readAt: serverTimestamp()}));
  assert.equal(await unread(), 0);
  assert.equal((await getDoc(doc(admin, "maintenanceRequests", "request-a", "readReceipts", "manager"))).exists(), false);
  await new Promise(resolve => setTimeout(resolve, 10));
  await assertSucceeds(setDoc(doc(admin, "maintenanceRequests", "request-a", "messages", "second"), message("New reply")));
  assert.equal(await unread(), 1);
});
test("announcements reach only their assigned recipients and cannot be posted by tenants", async () => {
  const announcement = {kind:"announcement",title:"Water interruption",body:"Tomorrow at 10 AM",senderId:"manager",senderName:"Management",recipientIds:["alice"],audience:"all",createdAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(admin,"messages","announcement"),announcement));
  await assertSucceeds(getDocs(query(collection(alice,"messages"),where("recipientIds","array-contains","alice"))));
  assert.equal((await getDoc(doc(alice,"messages","announcement"))).data().title,"Water interruption");
  await assertFails(getDoc(doc(bob,"messages","announcement")));
  await assertFails(setDoc(doc(alice,"messages","forged-announcement"),{...announcement,senderId:"alice"}));
  await assertSucceeds(setDoc(doc(alice,"users","alice","notificationReads","message_announcement"),{readAt:serverTimestamp()}));
});
test("meter records require immutable audit revisions and are private to assigned room tenants", async () => {
  const reading={period:"2026-10",readingDate:"2026-10-03",electricityPrevious:100,electricityCurrent:142,waterPrevious:20,waterCurrent:24.2,notes:"",createdAt:serverTimestamp(),createdBy:"manager",updatedAt:serverTimestamp(),updatedBy:"manager",revisionNumber:1,revisionId:"first"};
  const path=["rooms","random-room-id","meterReadings","2026-10"];
  await assertFails(setDoc(doc(admin,...path),reading));
  const batch=writeBatch(admin);
  batch.set(doc(admin,...path),reading);
  batch.set(doc(admin,...path,"revisions","first"),reading);
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(collection(alice,"rooms","random-room-id","meterReadings")));
  await assertFails(getDocs(collection(bob,"rooms","random-room-id","meterReadings")));
  await assertFails(setDoc(doc(alice,...path),{...reading,waterCurrent:999}));
  await assertFails(getDocs(collection(alice,...path,"revisions")));
  await assertFails(updateDoc(doc(admin,...path),{waterCurrent:25}));
  const saved=(await getDoc(doc(admin,...path))).data();
  const correction={...saved,waterCurrent:25,notes:"Corrected transcription",revisionId:"second",revisionNumber:2,updatedAt:serverTimestamp()};
  const edit=writeBatch(admin);edit.set(doc(admin,...path),correction);edit.set(doc(admin,...path,"revisions","second"),correction);
  await assertSucceeds(edit.commit());
  assert.equal((await getDoc(doc(admin,...path,"revisions","first"))).data().waterCurrent,24.2);
  await assertFails(updateDoc(doc(admin,...path,"revisions","first"),{waterCurrent:25}));
  await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),"users","bob"),{hasRoom:true,roomId:"random-room-id"}));
  await assertSucceeds(getDocs(collection(bob,"rooms","random-room-id","meterReadings")));
  await env.withSecurityRulesDisabled(async context=>updateDoc(doc(context.firestore(),"users","alice"),{hasRoom:false,roomId:""}));
  await assertFails(getDocs(collection(alice,"rooms","random-room-id","meterReadings")));
});
test("decreasing meter readings and orphan corrections are rejected",async()=>{
  const path=["rooms","random-room-id","meterReadings","2026-10"];
  const data={period:"2026-10",readingDate:"2026-10-03",electricityPrevious:100,electricityCurrent:99,waterPrevious:20,waterCurrent:24,notes:"",createdAt:serverTimestamp(),createdBy:"manager",updatedAt:serverTimestamp(),updatedBy:"manager",revisionNumber:1,revisionId:"bad"};
  const batch=writeBatch(admin);batch.set(doc(admin,...path),data);batch.set(doc(admin,...path,"revisions","bad"),data);
  await assertFails(batch.commit());
  await assertFails(setDoc(doc(admin,...path,"revisions","orphan"),{...data,revisionId:"orphan"}));
});
test("landlord inbox can read missing read markers and empty conversations", async () => {
  const receipt = await assertSucceeds(getDoc(doc(admin, "maintenanceRequests", "request-a", "readReceipts", "manager")));
  assert.equal(receipt.exists(), false);
  const messages = await assertSucceeds(getDocs(collection(admin, "maintenanceRequests", "request-a", "messages")));
  assert.equal(messages.empty, true);
  await assertSucceeds(setDoc(doc(alice, "maintenanceRequests", "request-a", "readReceipts", "alice"), { readAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(alice, "maintenanceRequests", "request-a", "readReceipts", "alice")));
  await assertFails(setDoc(doc(bob, "maintenanceRequests", "request-a", "readReceipts", "bob"), { readAt: serverTimestamp() }));
  await assertFails(getDoc(doc(alice, "maintenanceRequests", "request-a", "readReceipts", "manager")));
});
before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  const storageRules = await readFile(new URL("../storage.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({ projectId: "demo-boardease", firestore: { rules, host:"127.0.0.1", port:8085 }, storage: { rules:storageRules, host:"127.0.0.1", port:9199 } });
  alice = env.authenticatedContext("alice").firestore();
  bob = env.authenticatedContext("bob").firestore();
  applicant = env.authenticatedContext("applicant").firestore();
  admin = env.authenticatedContext("manager", { admin: true, role: "landlord" }).firestore();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db,"users","alice"), { name:"Alice", role:"user", hasRoom:true, roomId:"random-room-id", roomNumber:"201", roomRent:"3500" }),
      setDoc(doc(db,"users","bob"), { name:"Bob", role:"user", hasRoom:false }),
      setDoc(doc(db,"users","applicant"), { name:"Applicant", role:"user", hasRoom:false }),
      setDoc(doc(db,"rooms","random-room-id"), { number:"201", rent:"3500", type:"Room", status:"Occupied", tenantId:"alice" }),
      setDoc(doc(db,"rooms","available-room-id"), { number:"202", rent:"4000", type:"Room", status:"Available" }),
      setDoc(doc(db,"maintenanceRequests","request-a"), { tenantId:"alice", roomNumber:"201", title:"Leak", status:"in_progress" }),
      setDoc(doc(db,"notifications","notice-a"), { recipientId:"alice", type:"payment_update", title:"Update", read:false }),
      setDoc(doc(db,"messages","broadcast-a"), { senderId:"manager", recipientIds:["alice"], body:"House notice", createdAt:serverTimestamp() }),
    ]);
  });
});
after(async () => { await env?.cleanup(); });
function payment(status="pending") {
  return { tenantId:"alice", tenantName:"Alice", roomId:"random-room-id", roomNumber:"201", billingPeriod:"2026-10", referenceNumber:"1234567890123", dateSent:"10/03/2026", timeSent:"10:30 AM", amount:3500, receiptUrl:"data:image/jpeg;base64,YQ==", status, createdAt:serverTimestamp() };
}
test("profiles remain private and tenants cannot grant roles or assignments", async () => {
  await assertSucceeds(updateDoc(doc(alice,"users","alice"), { name:"New name", notificationsEnabled:false }));
  await assertFails(updateDoc(doc(alice,"users","alice"), { role:"admin" }));
  await assertFails(updateDoc(doc(alice,"users","alice"), { roomId:"available-room-id" }));
  await assertFails(getDoc(doc(bob,"users","alice")));
  await assertSucceeds(getDoc(doc(admin,"users","alice")));
  const emailOnly = env.authenticatedContext("email-only", { email:"admin@boardease.com" }).firestore();
  await assertFails(updateDoc(doc(emailOnly,"rooms","available-room-id"), { status:"Occupied" }));
  const landlordClaim = env.authenticatedContext("role-manager", { role:"landlord" }).firestore();
  await assertSucceeds(updateDoc(doc(landlordClaim,"rooms","available-room-id"), { status:"Occupied" }));
});
test("signup can save emergency contact without granting landlord rights", async () => {
  const newcomer = env.authenticatedContext("newcomer").firestore();
  await assertSucceeds(setDoc(doc(newcomer,"users","newcomer"), { name:"New", email:"new@example.com", phone:"09123456789", emergencyContact:"Parent", emergencyPhone:"09111111111", role:"user", hasRoom:false, createdAt:"2026-10-03" }));
  await assertFails(setDoc(doc(newcomer,"users","forged"), { name:"Fake", role:"admin", hasRoom:true }));
});
test("room browsing and application queries work with owner filters", async () => {
  await assertSucceeds(getDocs(query(collection(applicant,"rooms"),where("status","==","Available"))));
  const data = { tenantId:"applicant", tenantName:"Applicant", tenantEmail:"a@example.com", roomId:"available-room-id", roomNumber:"202", roomType:"Room", price:"4000", image:"", propertyName:"BoardEase", location:"Quezon City", floor:"2", unit:"202", status:"pending", createdAt:serverTimestamp() };
  await assertSucceeds(getDoc(doc(applicant,"applications","applicant__available-room-id")));
  await assertSucceeds(setDoc(doc(applicant,"applications","applicant__available-room-id"), data));
  await assertSucceeds(getDocs(query(collection(applicant,"applications"),where("tenantId","==","applicant"))));
  await assertSucceeds(getDocs(query(collection(applicant,"applications"),where("tenantId","==","applicant"),where("roomNumber","==","202"))));
  await assertSucceeds(setDoc(doc(applicant,"tourRequests","applicant__available-room-id"), { ...data, requestedDate:"2026-10-10", note:"Afternoon", createdAt:serverTimestamp() }));
  await assertSucceeds(getDocs(query(collection(applicant,"tourRequests"),where("tenantId","==","applicant"),where("roomNumber","==","202"))));
  await assertFails(getDocs(collection(bob,"applications")));
  await assertFails(updateDoc(doc(applicant,"applications","applicant__available-room-id"), { status:"approved" }));
  await assertFails(setDoc(doc(alice,"applications","alice__available-room-id"), { ...data, tenantId:"alice" }));
});
test("concurrent application submissions share one stable document", async () => {
  const ref = doc(applicant,"applications","applicant__available-room-id");
  const submit = () => runTransaction(applicant, async tx => {
    if ((await tx.get(ref)).exists()) throw new Error("Already submitted");
    tx.set(ref, { tenantId:"applicant", tenantName:"Applicant", tenantEmail:"a@example.com", roomId:"available-room-id", roomNumber:"202", roomType:"Room", price:"4000", image:"", status:"pending", createdAt:serverTimestamp() });
  });
  const results = await Promise.allSettled([submit(), submit()]);
  assert.equal(results.filter(r => r.status === "fulfilled").length,1);
  assert.equal((await getDocs(query(collection(applicant,"applications"),where("tenantId","==","applicant")))).size,1);
});
test("payment proof must start pending and only management can approve", async () => {
  const path = ["payments","alice__1234567890123"];
  await assertSucceeds(getDoc(doc(alice,...path)));
  await assertFails(setDoc(doc(alice,...path), payment("approved")));
  await assertFails(setDoc(doc(alice,...path), { ...payment(), amount:-1 }));
  await assertFails(setDoc(doc(alice,...path), { ...payment(), roomId:"available-room-id" }));
  await assertSucceeds(setDoc(doc(alice,...path),payment()));
  await assertFails(updateDoc(doc(alice,...path), { status:"approved" }));
  await assertFails(getDoc(doc(bob,...path)));
  await assertSucceeds(getDocs(query(collection(alice,"payments"),where("tenantId","==","alice"))));
  await assertSucceeds(updateDoc(doc(admin,...path), { status:"approved", approvedAt:serverTimestamp() }));
  await assertFails(updateDoc(doc(admin,...path), { amount:1 }));
});
test("maintenance messages require the request owner or a real landlord UID", async () => {
  const body = { senderId:"alice", senderName:"Alice", body:"Please check the leak", createdAt:serverTimestamp() };
  await assertSucceeds(setDoc(doc(alice,"maintenanceRequests","request-a","messages","a"),body));
  await assertFails(setDoc(doc(bob,"maintenanceRequests","request-a","messages","b"), { ...body, senderId:"bob" }));
  await assertFails(getDocs(collection(bob,"maintenanceRequests","request-a","messages")));
  await assertFails(setDoc(doc(admin,"maintenanceRequests","request-a","messages","c"), { ...body, senderId:"landlord" }));
  await assertSucceeds(setDoc(doc(admin,"maintenanceRequests","request-a","messages","d"), { ...body, senderId:"manager", senderName:"Management" }));
  await assertSucceeds(setDoc(doc(admin,"maintenanceRequests","request-a","readReceipts","manager"), { readAt:serverTimestamp() }));
  await assertFails(setDoc(doc(alice,"maintenanceRequests","request-a","readReceipts","manager"), { readAt:serverTimestamp() }));
  await assertFails(setDoc(doc(alice,"maintenanceRequests","wrong-room"), { tenantId:"alice", roomNumber:"202", title:"Leak", status:"in_progress", createdAt:serverTimestamp() }));
});
test("management can atomically assign the existing room document", async () => {
  const batch = writeBatch(admin);
  batch.update(doc(admin,"rooms","available-room-id"), { status:"Occupied", tenantId:"applicant" });
  batch.update(doc(admin,"users","applicant"), { hasRoom:true, roomId:"available-room-id", roomNumber:"202", roomRent:"4000" });
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(doc(applicant,"users","applicant"))).data().roomId,"available-room-id");
  assert.equal((await getDocs(collection(admin,"rooms"))).size,2);
  await assertFails(updateDoc(doc(alice,"rooms","random-room-id"), { status:"Available" }));
});
test("read markers and account requests are scoped to their owner", async () => {
  await assertSucceeds(updateDoc(doc(alice,"notifications","notice-a"), { read:true }));
  await assertFails(updateDoc(doc(bob,"notifications","notice-a"), { read:true }));
  await assertFails(updateDoc(doc(alice,"notifications","notice-a"), { title:"Forged" }));
  await assertSucceeds(getDocs(query(collection(alice,"messages"),where("recipientIds","array-contains","alice"))));
  await assertFails(getDoc(doc(bob,"messages","broadcast-a")));
  await assertSucceeds(setDoc(doc(alice,"users","alice","notificationReads","rent_2026-10"), { readAt:serverTimestamp() }));
  await assertSucceeds(setDoc(doc(alice,"accountRequests","alice"), { tenantId:"alice", kind:"deletion", status:"pending", createdAt:serverTimestamp() }));
  await assertFails(setDoc(doc(bob,"accountRequests","alice"), { tenantId:"alice", kind:"vacate", status:"pending", createdAt:serverTimestamp() }));
});
test("pending applications can be cancelled and retried without approval privileges", async () => {
  const ref = doc(applicant,"applications","applicant__available-room-id");
  const data = { tenantId:"applicant",roomId:"available-room-id",roomNumber:"202",status:"pending",createdAt:serverTimestamp() };
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(updateDoc(ref,{ status:"cancelled",updatedAt:serverTimestamp() }));
  await assertSucceeds(setDoc(ref,{ ...data,createdAt:serverTimestamp() }));
  await assertFails(updateDoc(ref,{ status:"cancelled",tenantId:"bob" }));
});
test("tenants may delete only their approved or cancelled applications", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db=context.firestore();
    await Promise.all(["approved","cancelled","pending","rejected"].map(status =>
      setDoc(doc(db,"applications",`applicant__${status}`), { tenantId:"applicant",status })
    ));
    await setDoc(doc(db,"applications","alice__approved"), { tenantId:"alice",status:"approved" });
  });
  await assertSucceeds(deleteDoc(doc(applicant,"applications","applicant__approved")));
  await assertSucceeds(deleteDoc(doc(applicant,"applications","applicant__cancelled")));
  await assertFails(deleteDoc(doc(applicant,"applications","applicant__pending")));
  await assertFails(deleteDoc(doc(applicant,"applications","applicant__rejected")));
  await assertFails(deleteDoc(doc(applicant,"applications","alice__approved")));
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertFails(deleteDoc(doc(unauthenticated,"applications","applicant__approved")));
  await assertSucceeds(deleteDoc(doc(admin,"applications","applicant__pending")));
});
test("rejected payment proof can be corrected but approved records remain immutable for tenants", async () => {
  const ref = doc(alice,"payments","alice__1234567890123");
  await assertSucceeds(setDoc(ref,payment()));
  await assertSucceeds(updateDoc(doc(admin,"payments","alice__1234567890123"),{ status:"rejected" }));
  await assertSucceeds(setDoc(ref,{ ...payment(),amount:3400 }));
  await assertSucceeds(updateDoc(doc(admin,"payments","alice__1234567890123"),{ status:"approved" }));
  await assertFails(setDoc(ref,payment()));
});
test("deactivated users cannot reuse an existing token to recreate profiles", async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db=context.firestore();
    await setDoc(doc(db,"deactivatedAccounts","alice"),{ deletedAt:serverTimestamp() });
  });
  await assertFails(getDoc(doc(alice,"users","alice")));
  await assertFails(getDocs(collection(alice,"rooms")));
  await assertFails(setDoc(doc(alice,"users","alice"),{ name:"Resurrected",role:"user",hasRoom:false }));
  await assertSucceeds(getDoc(doc(admin,"users","alice")));
});
test("unused Firebase Storage paths deny all client access", async () => {
  const path = "payment-proofs/alice/receipt.jpg";
  const aliceStorage = alice.storage("gs://demo-boardease.appspot.com");
  const bobStorage = bob.storage("gs://demo-boardease.appspot.com");
  const adminStorage = admin.storage("gs://demo-boardease.appspot.com");
  await env.withSecurityRulesDisabled(async context => {
    await uploadBytes(ref(context.storage("gs://demo-boardease.appspot.com"),path),new Uint8Array([1,2,3]),{contentType:"image/jpeg"});
  });
  await assertFails(uploadBytes(ref(aliceStorage,path),new Uint8Array([1,2,3]),{contentType:"image/jpeg"}));
  await assertFails(getBytes(ref(aliceStorage,path)));
  await assertFails(getBytes(ref(adminStorage,path)));
  await assertFails(getBytes(ref(bobStorage,path)));
  await assertFails(uploadBytes(ref(bobStorage,"payment-proofs/alice/forged.jpg"),new Uint8Array([1]),{contentType:"image/jpeg"}));
  await assertFails(uploadBytes(ref(aliceStorage,"payment-proofs/alice/not-image.txt"),new Uint8Array([1]),{contentType:"text/plain"}));
  await assertFails(uploadBytes(ref(aliceStorage,"payment-proofs/alice/large.jpg"),new Uint8Array(10 * 1024 * 1024),{contentType:"image/jpeg"}));
});
