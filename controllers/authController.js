import admin from '../config/firebaseAdmin.js';
import {createUserDoc} from '../models/userModel.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const allowedRoles = ['admin', 'fieldworker', 'volunteer', 'coordinator'];
const JWT_SECRET = process.env.JWT_SECRET || 'my_jwt_secret';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY; 

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^[0-9\-\+]{9,15}$/.test(phone);



// -------------Register User--------------

export const registerUser = async (req, res) => {
    const { email, password, name, role, phone_number } = req.body;

    const normalizedEmail = email?.trim().toLowerCase();
    const trimmedName = name?.trim();
    const trimmedPhone = phone_number?.trim() || null;

    // Field presence check
    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email is required' });
    }
    if (!password) {
        return res.status(400).json({ error: 'Password is required' });
    }
    if (!trimmedName) {
        return res.status(400).json({ error: 'Name is required' });
    }
    if (!role) {
        return res.status(400).json({ error: 'Role is required' });
    }
    // Email format
    if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    // Password strength
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Role check
    if (!allowedRoles.includes(role.toLowerCase())) {
        return res.status(400).json({ error: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}` });
    }

    //Phone check 
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
        console.error('[Register Error]', error);

        if (error.code === 'auth/email-already-exists') {
            return res.status(409).json({ error: 'Email already exists' });
        }

        return res.status(400).json({ error: error.message });
    }
};


// -------------Login User--------------

export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  // Validate login fields
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    // Step 1: Verify credentials via Firebase REST API
    const firebaseRes = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      { email, password, returnSecureToken: true }
    );

    const { localId: uid } = firebaseRes.data;

    // Step 2: Fetch user info from Firebase Admin SDK
    const user = await admin.auth().getUser(uid);
    const role = user.customClaims?.role || 'user';

    // Step 3: Generate JWT for session
    const token = jwt.sign({ uid, email, role }, JWT_SECRET, { expiresIn: '2h' });

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