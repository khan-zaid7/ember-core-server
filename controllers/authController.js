// controllers/authController.jsAdd commentMore actions
import admin from '../config/firebaseAdmin.js';
import { createUserDoc } from '../models/userModel.js';

export const registerUser = async (req, res) => {
    console.log('working');
  const { email, password, name, role, phone_number } = req.body;

  if (!email || !password || !name || !role) {
    return res.status(400).json({ error: 'email, password, name, and role are required' });
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role });

    await createUserDoc(userRecord.uid, {
      name,
      email,
      role,
      phone_number,
    });

    return res.status(201).json({
      message: 'User registered successfully',
      user_id: userRecord.uid,
      email: userRecord.email,
      role,
      name: userRecord.displayName,
    });
  } catch (error) {
    console.error('[Register Error]', error);
    return res.status(400).json({ error: error.message });
  }
};