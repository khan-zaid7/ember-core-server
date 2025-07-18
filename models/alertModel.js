import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const alerts = db.collection('alerts');

export const createAlertDoc = async (id, data) => {
  return await alerts.doc(id).set({
    alert_id: id,
    user_id: data.user_id,
    type: data.type,
    location_id: data.location_id,
    description: data.description,
    priority: data.priority || 'normal',
    timestamp: data.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    sent_via: data.sent_via || 'app',
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const updateAlertDoc = async (id, data) => {
  return await alerts.doc(id).update({
    user_id: data.user_id,
    type: data.type,
    location_id: data.location_id,
    description: data.description,
    priority: data.priority || 'normal',
    timestamp: data.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    sent_via: data.sent_via || 'app',
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};