import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const usersCollection = db.collection('users');

export const createUserDoc = async (uid, data) => {
  return await usersCollection.doc(uid).set({
    user_id: uid,
    name: data.name,
    email: data.email,
    phone_number: data.phone_number || null,
    image_url: data.image_url || null,
    role: data.role,
    reset_token: null,
    token_expire: null,
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const updateUserDoc = async (uid, data) => {
  return await usersCollection.doc(uid).update({
    name: data.name,
    email: data.email,
    role: data.role,
    phone_number: data.phone_number || null,
    image_url: data.image_url || null,
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};
