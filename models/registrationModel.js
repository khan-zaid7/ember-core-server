import admin from '../config/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const db = admin.firestore();
const registrations = db.collection('registrations');

export const createRegistrationDoc = async (id, data) => {
  return await registrations.doc(id).set({
    registration_id: id,
    user_id: data.user_id,
    person_name: data.person_name,
    age: data.age,
    gender: data.gender,
    location_id: data.location_id,
    timestamp: data.timestamp || FieldValue.serverTimestamp(),
    synced: true,
    sync_status_message: 'Synced successfully',
  });
};

export const updateRegistrationDoc = async (id, data) => {
  return await registrations.doc(id).update({
    person_name: data.person_name,
    age: data.age,
    gender: data.gender,
    location_id: data.location_id,
    timestamp: data.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    synced: true,
    sync_status_message: data.sync_status_message || 'Updated',
  });
};