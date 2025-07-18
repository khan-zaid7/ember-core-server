// In ../../models/userModel.js
import admin from '../config/firebaseAdmin.js';
import bcrypt from 'bcryptjs'; // You'll need to install this: npm install bcryptjs

const db = admin.firestore();
const usersCollection = db.collection('users');

// A function to hash password (or put directly in create/update)
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10); // Generate a salt
  return await bcrypt.hash(password, salt); // Hash the password with the salt
}

export const createUserDoc = async (uid, data) => {
  const passwordHash = data.password ? await hashPassword(data.password) : null;

  return await usersCollection.doc(uid).set({
    user_id: uid,
    name: data.name,
    email: data.email,
    password: passwordHash, // <--- STORE THE HASHED PASSWORD
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
  const updateFields = {
    name: data.name,
    email: data.email,
    role: data.role,
    phone_number: data.phone_number || null,
    image_url: data.image_url || null,
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  };

  if (data.password !== undefined && data.password !== null && data.password !== '') {
    updateFields.password = await hashPassword(data.password); // <--- HASH BEFORE UPDATING
  }
  
  return await usersCollection.doc(uid).update(updateFields);
};