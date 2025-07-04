// controllers/sync/syncUserFromClient.js
import { createUserDoc, updateUserDoc } from '../../models/userModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const usersCollection = db.collection('users');

export const syncUserFromClient = async (req, res) => {
  const user = req.body;

  if (!user.user_id || !user.name || !user.email || !user.role || !user.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = usersCollection.doc(user.user_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(user.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
        });
      }

      // ✅ Safe to update
      await updateUserDoc(user.user_id, user);
    } else {
      // 🔍 Check if another user already exists with this email
      const existingEmail = await usersCollection.where('email', '==', user.email).get();

      if (!existingEmail.empty) {
        const existingUser = existingEmail.docs[0].data();
        return res.status(409).json({
          error: 'Conflict: Email already exists',
          conflict_field: 'email',
          latest_data: existingUser,
        });
      }

      // ✅ Safe to create new user
      await createUserDoc(user.user_id, user);
    }

    return res.status(200).json({ message: 'User synced successfully' });
  } catch (err) {
    console.error('❌ User sync error:', err);
    return res.status(500).json({ error: 'User sync failed' });
  }
};
