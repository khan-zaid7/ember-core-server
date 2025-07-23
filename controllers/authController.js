// authController.js

import admin from '../config/firebaseAdmin.js';
import { createUserDoc } from '../models/userModel.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const allowedRoles = ['admin', 'fieldworker', 'volunteer', 'coordinator'];
const JWT_SECRET = process.env.JWT_SECRET || 'my_jwt_secret';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^[0-9\-\+]{9,15}$/.test(phone);

const db = admin.firestore();
const usersCollection = db.collection('users');
const OTP_EXPIRATION_MINUTES = 10;
import bcrypt from 'bcryptjs';

// 1. Register User
export const registerUser = async (req, res) => {
  const { email, password, name, role, phone_number } = req.body;

  const normalizedEmail = email?.trim().toLowerCase();
  const trimmedName = name?.trim();
  const trimmedPhone = phone_number?.trim() || null;

  if (!normalizedEmail || !password || !trimmedName || !role) {
    return res.status(400).json({ error: 'All required fields must be filled' });
  }

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  if (!allowedRoles.includes(role.toLowerCase())) {
    return res.status(400).json({ error: `Invalid role. Allowed: ${allowedRoles.join(', ')}` });
  }

  if (phone_number && !isValidPhone(trimmedPhone)) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  try {
    const userRecord = await admin.auth().createUser({
      email: normalizedEmail,
      password,
      displayName: trimmedName,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role: role.toLowerCase() });

    await createUserDoc(userRecord.uid, {
      name: trimmedName,
      email: normalizedEmail,
      role: role.toLowerCase(),
      phone_number: trimmedPhone,
    });

    return res.status(201).json({
      message: 'User registered successfully',
      user_id: userRecord.uid,
      email: userRecord.email,
      role: role.toLowerCase(),
      name: userRecord.displayName,
    });
  } catch (error) {
    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    return res.status(400).json({ error: error.message });
  }
};

// 2. Login User
export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  // Normalize email to lowercase for consistency
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !password || !isValidEmail(normalizedEmail) || password.length < 6) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  try {
    const firebaseRes = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { email: normalizedEmail, password, returnSecureToken: true }
    );

    const { localId: uid } = firebaseRes.data;
    const user = await admin.auth().getUser(uid);
    const role = user.customClaims?.role || 'user';

    const token = jwt.sign({ uid, email: normalizedEmail, role }, JWT_SECRET, { expiresIn: '2h' });

    return res.status(200).json({
      message: 'Login successful',
      token,
      expiresIn: '2h',
    });
  } catch (error) {
    console.error('[Login Error]', error?.response?.data || error.message);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
};

// 3. Forgot Password (Send OTP)
export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  // Normalize email to lowercase for consistency
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: 'Valid email is required' });
  }

  try {
    const querySnapshot = await usersCollection.where('email', '==', normalizedEmail).get();

    if (querySnapshot.empty) {
      return res.status(404).json({ message: 'User not found with this email' });
    }

    const otp = crypto.randomInt(100000, 999999);
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000)
    );

    await db.collection('otps').doc(normalizedEmail).set({
      email: normalizedEmail,
      otp,
      expiresAt,
    });

    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: 'neehalhspam@gmail.com',
        pass: 'sqwt zopv haes ijpo',
      },
    });

    await transporter.sendMail({
      from: 'neehalhspam@gmail.com',
      to: normalizedEmail,
      subject: 'Password Reset OTP',
      text: `Your OTP for password reset is: ${otp}`,
    });

    console.log('✅ OTP sent successfully to:', normalizedEmail);
    return res.status(200).json({ message: 'OTP sent successfully' });
  } catch (error) {
    console.error('❌ Error in forgotPassword:', error);
    return res.status(500).json({ message: 'Failed to send OTP', error: error.message });
  }
};

// 4. Split OTP Flow

// a. OTP Verification
export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  // Normalize email to lowercase for consistency
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
    const otpDoc = await db.collection('otps').doc(normalizedEmail).get();

    if (!otpDoc.exists) {
      return res.status(400).json({ message: 'No OTP found. Please request a new one.' });
    }

    const { otp: storedOtp, expiresAt } = otpDoc.data();

    if (parseInt(otp) !== storedOtp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (expiresAt.toDate() < new Date()) {
      return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
    }

    return res.status(200).json({ message: 'OTP verified successfully' });
  } catch (err) {
    return res.status(500).json({ message: 'Error verifying OTP', error: err.message });
  }
};
// Helper function to safely convert a value to an ISO 8601 string.
// It handles Firestore Timestamps, Date objects, and already existing strings.
const toISOStringSafe = (value) => {
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  // If it's already a string, assume it's ISO and return it directly
  if (typeof value === 'string') {
    return value;
  }
  // If it's a Date object, convert it
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null; // Return null for undefined, null, or other unexpected types
};

export const resetPassword = async (req, res) => {
  const { email, password, confirm_password, otp } = req.body;

  try {
    if (!email || !password || !confirm_password) {
      return res.status(400).json({ message: 'All fields (email, password, confirm_password, OTP) are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ message: 'Passwords do not match.' });
    }

    let actualUid;
    let finalUserData;

    try {
      // Find user by email in Firebase Auth
      const userRecord = await admin.auth().getUserByEmail(email);
      actualUid = userRecord.uid;
      console.log(`User found in Auth: ${actualUid}`);

      // Update password in Firebase Auth
      await admin.auth().updateUser(actualUid, {
        password: password,
      });
      console.log(`Firebase Auth password updated for ${email}`);

      // Hash password for Firestore storage (bcryptjs)
      const finalHashedPasswordForFirestore = await bcrypt.hash(password, 10);

      // Update user in Firestore
      await usersCollection.doc(actualUid).update({
        password: finalHashedPasswordForFirestore,
        updated_at: admin.firestore.FieldValue.serverTimestamp(), // Ensure this is a Timestamp
      });
      console.log(`Firestore password and updated_at updated for ${email}`);

      // Fetch the updated user document to return the complete data
      const updatedUserDoc = await usersCollection.doc(actualUid).get();
      finalUserData = updatedUserDoc.data();

    } catch (authError) {
      // If user not found in Firebase Auth, this could be a new client-only user
      if (authError.code === 'auth/user-not-found') {
        console.log(`User not found in Firebase Auth for ${email}. Attempting to create new Auth user.`);

        // Check if user exists locally (in Firestore, not Auth yet) to get their old Firestore UID
        const localUserByEmail = await usersCollection.where('email', '==', email).limit(1).get();
        let oldFirestoreUid = null;
        if (!localUserByEmail.empty) {
          oldFirestoreUid = localUserByEmail.docs[0].id;
          console.log(`Found unauthenticated user in Firestore: ${oldFirestoreUid}`);
        }

        // Create user in Firebase Auth
        const newUserRecord = await admin.auth().createUser({
          email: email,
          password: password, // This is the plain text password from input
          emailVerified: true, // Assuming password reset implies verification
        });
        actualUid = newUserRecord.uid;
        console.log(`New Firebase Auth user created with UID: ${actualUid}`);

        // Hash password for Firestore storage
        const newHashedPasswordForFirestore = await bcrypt.hash(password, 10);

        let userData = {
          user_id: actualUid,
          email: email,
          password: newHashedPasswordForFirestore, // Store hashed password
          name: oldFirestoreUid ? localUserByEmail.docs[0].data().name : 'User', // Use existing name if available
          role: oldFirestoreUid ? localUserByEmail.docs[0].data().role : 'fieldworker', // Use existing role or default
          phone_number: oldFirestoreUid ? localUserByEmail.docs[0].data().phone_number : null,
          image_url: oldFirestoreUid ? localUserByEmail.docs[0].data().image_url : null,
          location: oldFirestoreUid ? localUserByEmail.docs[0].data().location : null,
          created_at: oldFirestoreUid ? localUserByEmail.docs[0].data().created_at : admin.firestore.FieldValue.serverTimestamp(), // Ensure Timestamp for new user
          updated_at: admin.firestore.FieldValue.serverTimestamp(), // Ensure Timestamp
          synced: true, // Mark as synced after creation
        };

        // Delete the old Firestore document if a new Auth user was created and UID changed
        if (oldFirestoreUid && oldFirestoreUid !== actualUid) {
          await usersCollection.doc(oldFirestoreUid).delete();
          console.log(`Deleted old Firestore document for UID: ${oldFirestoreUid}`);
        }

        // Set the new/updated user data in Firestore with the actualUid
        await usersCollection.doc(actualUid).set(userData);
        console.log(`Firestore user data set/updated for new Auth user ${actualUid}`);

        // Fetch the newly set document to ensure consistent return structure
        const newUserDoc = await usersCollection.doc(actualUid).get();
        finalUserData = newUserDoc.data();

      } else {
        console.error("Firebase Auth Error:", authError);
        return res.status(500).json({ message: 'Authentication error during password reset.' });
      }
    }

    // Return success response with user data, safely converting dates
    return res.status(200).json({
      message: 'Password reset successfully',
      user: {
        user_id: actualUid,
        ...finalUserData,
        password, // Override hashed password with plain-text
        created_at: toISOStringSafe(finalUserData?.created_at),
        updated_at: toISOStringSafe(finalUserData?.updated_at),
      }
    });


  } catch (error) {
    console.error('❌ Error in resetPassword:', error);
    let errorMessage = 'An unexpected error occurred during password reset.';
    if (error.code) {
      errorMessage = `Firebase Error: ${error.message}`;
    } else if (error.message) {
      errorMessage = error.message;
    }
    res.status(500).json({ message: errorMessage });
  }
};