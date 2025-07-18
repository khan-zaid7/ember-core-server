import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const locations = db.collection('locations');

export const createLocationDoc = async (id, data) => {
  return await locations.doc(id).set({
    location_id: id,
    user_id: data.user_id,
    name: data.name,
    type: data.type,
    latitude: data.latitude,
    longitude: data.longitude,
    added_at: data.added_at || admin.firestore.FieldValue.serverTimestamp(),
    description: data.description || '',
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const updateLocationDoc = async (id, data) => {
  return await locations.doc(id).update({
    user_id: data.user_id,
    name: data.name,
    type: data.type,
    latitude: data.latitude,
    longitude: data.longitude,
    added_at: data.added_at || admin.firestore.FieldValue.serverTimestamp(),
    description: data.description || '',
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};