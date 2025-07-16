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

// b. Reset Password after OTP Verification
export const resetPassword = async (req, res) => {
  const { email, password, confirm_password } = req.body;
  
  // Normalize email to lowercase for consistency
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !password || !confirm_password) {
    return res.status(400).json({ message: 'Email and new password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long' });
  }

  if (password !== confirm_password) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const querySnapshot = await usersCollection.where('email', '==', normalizedEmail).get();

    if (querySnapshot.empty) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userDoc = querySnapshot.docs[0];
    const uid = userDoc.id;

    // Check if user exists in Firebase Auth and fix UID mismatch if needed
    let actualUid = uid;
    try {
      await admin.auth().getUser(uid);
    } catch (authError) {
      if (authError.code === 'auth/user-not-found') {
        // Try to find user by email in Firebase Auth
        try {
          const firebaseUserByEmail = await admin.auth().getUserByEmail(normalizedEmail);
          actualUid = firebaseUserByEmail.uid;
          
          // Fix UID mismatch in Firestore
          const userData = userDoc.data();
          await usersCollection.doc(uid).delete();
          await usersCollection.doc(actualUid).set({
            ...userData,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
          
        } catch (emailError) {
          if (emailError.code === 'auth/user-not-found') {
            // Create new user in Firebase Auth
            const userData = userDoc.data();
            const newFirebaseUser = await admin.auth().createUser({
              email: normalizedEmail,
              password: password,
              displayName: userData.name,
            });
            
            actualUid = newFirebaseUser.uid;
            
            if (userData.role) {
              await admin.auth().setCustomUserClaims(actualUid, { role: userData.role });
            }
            
            // Update Firestore with new UID
            await usersCollection.doc(uid).delete();
            await usersCollection.doc(actualUid).set({
              ...userData,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            throw emailError;
          }
        }
      } else {
        throw authError;
      }
    }

    // Update password
    await admin.auth().updateUser(actualUid, { password: password });

    // Update Firestore document
    await usersCollection.doc(actualUid).update({
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Clean up OTP
    await db.collection('otps').doc(normalizedEmail).delete();

    console.log('✅ Password reset completed for:', normalizedEmail);
    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('❌ Error in resetPassword:', err);
    return res.status(500).json({ message: 'Error resetting password', error: err.message });
  }
};
