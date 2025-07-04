import { createRegistrationDoc, updateRegistrationDoc } from '../../models/registrationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const collection = db.collection('registrations');

export const syncRegistrationFromClient = async (req, res) => {
  const r = req.body;

  if (!r.registration_id || !r.user_id || !r.person_name || !r.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = collection.doc(r.registration_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(r.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'registration_id',
          latest_data: serverData,
        });
      }

      await updateRegistrationDoc(r.registration_id, r);
    } else {
      await createRegistrationDoc(r.registration_id, r);
    }

    return res.status(200).json({ message: 'Registration synced successfully' });
  } catch (err) {
    console.error('❌ Registration sync error:', err);
    return res.status(500).json({ error: 'Registration sync failed' });
  }
};
