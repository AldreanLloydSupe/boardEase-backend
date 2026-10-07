import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10 });

const db = getFirestore();

async function landlordIds() {
  const listedUsers = await getAuth().listUsers(1000);
  return listedUsers.users
    .filter((user) => user.customClaims?.admin === true || user.customClaims?.role === "landlord")
    .map((user) => user.uid);
}

async function notify(recipientId, data) {
  if (!recipientId) return;
  const id = db.collection("notifications").doc().id;
  await db.collection("notifications").doc(id).set({
    recipientId,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    ...data,
  });
}

async function notifyLandlords(data) {
  const ids = await landlordIds();
  await Promise.all(ids.map((id) => notify(id, data)));
}

const auditFields = {
  applications: ["status", "roomId", "roomNumber"],
  maintenanceRequests: ["status", "priority"],
  payments: ["status", "amount", "billingPeriod"],
  meterReadings: [
    "electricityPrevious",
    "electricityCurrent",
    "waterPrevious",
    "waterCurrent",
    "revisionNumber",
  ],
};

async function auditChange(collectionName, documentId, before, after, event) {
  const fields = auditFields[collectionName] || [];
  const changed = fields.filter(
    (field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]),
  );
  if (!changed.length) return;
  await db.collection("auditLogs").add({
    action: "update",
    collection: collectionName,
    documentId,
    changedFields: changed,
    actorId: event.authId || "system",
    createdAt: FieldValue.serverTimestamp(),
  });
}

export const notifyApplicationCreated = onDocumentCreated("applications/{applicationId}", async (event) => {
  const application = event.data?.data();
  if (!application) return;
  await notifyLandlords({
    type: "application",
    title: "New room application",
    body: `${application.tenantName || "A tenant"} applied for Room ${application.roomNumber || "requested room"}.`,
    sourceId: event.params.applicationId,
    route: "/landlord/pending-applications",
  });
});

export const notifyTourCreated = onDocumentCreated("tourRequests/{tourRequestId}", async (event) => {
  const tour = event.data?.data();
  if (!tour) return;
  await notifyLandlords({
    type: "tour",
    title: "New tour request",
    body: `${tour.tenantName || "A tenant"} requested a tour for Room ${tour.roomNumber || "requested room"}.`,
    sourceId: event.params.tourRequestId,
    route: "/landlord/pending-applications",
  });
});

export const notifyMaintenanceCreated = onDocumentCreated("maintenanceRequests/{requestId}", async (event) => {
  const request = event.data?.data();
  if (!request) return;
  await notifyLandlords({
    type: "maintenance",
    title: request.priority === "urgent" ? "Urgent maintenance request" : "New maintenance request",
    body: `${request.tenantName || "A tenant"} reported ${request.title || "a maintenance issue"}.`,
    sourceId: event.params.requestId,
    route: "/landlord/requests",
  });
});

export const notifyMaintenanceUpdated = onDocumentUpdated("maintenanceRequests/{requestId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !after.tenantId) return;
  await notify(after.tenantId, {
    type: "maintenance_update",
    title: "Maintenance request updated",
    body: `${after.title || "Your request"} is now ${String(after.status || "updated").replaceAll("_", " ")}.`,
    sourceId: event.params.requestId,
    route: "/tenant/applications",
  });
});

export const notifyMaintenanceMessageCreated = onDocumentCreated(
  "maintenanceRequests/{requestId}/messages/{messageId}",
  async (event) => {
    const message = event.data?.data();
    if (!message?.body) return;
    const request = await db.collection("maintenanceRequests").doc(event.params.requestId).get();
    const requestData = request.data();
    if (!requestData) return;
    const isTenantMessage = message.senderId === requestData.tenantId;
    if (isTenantMessage) {
      await notifyLandlords({
        type: "maintenance_message",
        title: "New maintenance reply",
        body: `${requestData.tenantName || "A tenant"} replied to ${requestData.title || "a maintenance request"}.`,
        sourceId: event.params.requestId,
        route: "/landlord/requests",
      });
    } else if (requestData.tenantId) {
      await notify(requestData.tenantId, {
        type: "maintenance_message",
        title: "New maintenance message",
        body: `Management replied to ${requestData.title || "your maintenance request"}.`,
        sourceId: event.params.requestId,
        route: "/tenant/applications",
      });
    }
  },
);

export const notifyPaymentCreated = onDocumentCreated("payments/{paymentId}", async (event) => {
  const payment = event.data?.data();
  if (!payment) return;
  await notifyLandlords({
    type: "payment",
    title: "Payment proof submitted",
    body: `${payment.tenantName || "A tenant"} submitted payment proof for review.`,
    sourceId: event.params.paymentId,
    route: "/landlord/finance",
  });
});

export const notifyPaymentUpdated = onDocumentUpdated("payments/{paymentId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !after.tenantId) return;
  await notify(after.tenantId, {
    type: "payment_update",
    title: after.status === "approved" ? "Payment approved" : "Payment update",
    body: `Your payment proof was ${after.status || "updated"}.`,
    sourceId: event.params.paymentId,
    route: "/tenant/payments",
  });
});

export const notifyApplicationUpdated = onDocumentUpdated("applications/{applicationId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !after.tenantId) return;
  await notify(after.tenantId, {
    type: "application_update",
    title: after.status === "rejected" ? "Application update" : "Application status changed",
    body: `Your application for Room ${after.roomNumber || "your requested room"} is ${after.status}.`,
    sourceId: event.params.applicationId,
    route: "/tenant/applications",
  });
});

export const notifyTourUpdated = onDocumentUpdated("tourRequests/{tourRequestId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !after.tenantId) return;
  await notify(after.tenantId, {
    type: "tour_update",
    title: "Tour request updated",
    body: `Your tour request is now ${String(after.status).replaceAll("_", " ")}.`,
    sourceId: event.params.tourRequestId,
    route: "/tenant/applications",
  });
});

export const assignApprovedApplication = onDocumentUpdated("applications/{applicationId}", async (event) => {
  const before = event.data?.before.data();
  const application = event.data?.after.data();
  if (!before || !application || before.status === "approved" || application.status !== "approved") return;
  if (!application.tenantId || !application.roomId || !application.roomNumber) return;

  const roomRef = db.collection("rooms").doc(String(application.roomId));
  const tenantRef = db.collection("users").doc(String(application.tenantId));
  const assigned = await db.runTransaction(async (transaction) => {
    const room = await transaction.get(roomRef);
    const tenant = await transaction.get(tenantRef);
    const current = room.data();
    const profile = tenant.data();
    if (!current || !profile || String(current.number) !== String(application.roomNumber)) {
      throw new Error("The requested room or tenant profile no longer exists.");
    }
    if (current.tenantId && current.tenantId !== application.tenantId) {
      throw new Error("The requested room is already occupied.");
    }
    if (profile.hasRoom && profile.roomId !== application.roomId) {
      throw new Error("The tenant is already assigned to another room.");
    }
    if (profile.hasRoom && profile.roomId === application.roomId) return false;
    transaction.set(roomRef, {
      number: String(application.roomNumber),
      type: application.roomType || "Room",
      rent: application.price || "0",
      status: "Occupied",
      tenant: application.tenantName || "Tenant",
      tenantId: application.tenantId,
      applicationId: event.params.applicationId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(tenantRef, {
      hasRoom: true,
      roomId: String(application.roomNumber),
      roomNumber: String(application.roomNumber),
      roomType: application.roomType || "Room",
      roomRent: application.price || "0",
      applicationId: event.params.applicationId,
    }, { merge: true });
    return true;
  });
  if (!assigned) return;
  await notify(application.tenantId, {
    type: "application_approved",
    title: "Application approved",
    body: `Your application for Room ${application.roomNumber} was approved.`,
    sourceId: event.params.applicationId,
    route: "/tenant/tenant-home",
  });
});

export const sendRentReminders = onSchedule("every day 08:00", async () => {
  const users = await db.collection("users").where("hasRoom", "==", true).get();
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const batch = db.batch();
  users.docs.forEach((user) => {
    const profile = user.data();
    if (profile.paymentReminders === false) return;
    const dueDay = Number(profile.rentDueDay || 5);
    const daysUntilDue = dueDay - now.getUTCDate();
    const configuredTiming = Number(profile.reminderTiming || 3);
    const reminderDays = [1, 3, 7].includes(configuredTiming) ? configuredTiming : 3;
    const overdue = daysUntilDue < 0;
    if (!overdue && ![reminderDays, 0].includes(daysUntilDue)) return;
    const ref = db.collection("notifications").doc(`rent-${user.id}-${monthKey}-${dueDay}`);
    batch.set(ref, {
      recipientId: user.id,
      type: overdue ? "rent_overdue" : daysUntilDue === 0 ? "rent_due" : "rent_reminder",
      title: overdue ? "Rent payment overdue" : daysUntilDue === 0 ? "Rent is due today" : "Rent payment reminder",
      body: overdue
        ? `Your rent was due on the ${dueDay}. Please submit your payment proof.`
        : `Your rent is due on the ${dueDay}${dueDay === 1 ? "st" : dueDay === 2 ? "nd" : dueDay === 3 ? "rd" : "th"} of the month.`,
      read: false,
      createdAt: Timestamp.now(),
    }, { merge: true });
  });
  await batch.commit();
});

export const auditApplicationChanges = onDocumentUpdated("applications/{applicationId}", async (event) => {
  await auditChange("applications", event.params.applicationId, event.data?.before.data(), event.data?.after.data(), event);
});

export const auditMaintenanceChanges = onDocumentUpdated("maintenanceRequests/{requestId}", async (event) => {
  await auditChange("maintenanceRequests", event.params.requestId, event.data?.before.data(), event.data?.after.data(), event);
});

export const auditPaymentChanges = onDocumentUpdated("payments/{paymentId}", async (event) => {
  await auditChange("payments", event.params.paymentId, event.data?.before.data(), event.data?.after.data(), event);
});

export const auditMeterChanges = onDocumentUpdated(
  "rooms/{roomId}/meterReadings/{period}",
  async (event) => {
    await auditChange(
      "meterReadings",
      `${event.params.roomId}/${event.params.period}`,
      event.data?.before.data(),
      event.data?.after.data(),
      event,
    );
  },
);
