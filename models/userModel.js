
// models/userModel.jsAdd commentMore actions
import admin from '../config/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const db = admin.firestore();
const usersCollection = db.collection('users');

export const createUserDoc = async (uid, data) => {
  return await usersCollection.doc(uid).set({
    user_id: uid,
    name: data.name,
    email: data.email,
    phone_number: data.phone_number || null,
    role: data.role,
    reset_token: null,
    token_expire: null,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
};