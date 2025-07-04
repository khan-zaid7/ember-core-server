import { createLocationDoc, updateLocationDoc } from '../../models/locationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('locations');

export const syncLocationFromClient = async (req, res) => {
  const l = req.body;

  if (!l.location_id || !l.user_id || !l.name || !l.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = col.doc(l.location_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const clientUpdatedAt = new Date(l.updated_at);
      const serverUpdatedAt = new Date(serverData.updated_at);

      if (clientUpdatedAt < serverUpdatedAt) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'location_id',
          latest_data: serverData,
        });
      }

      await updateLocationDoc(l.location_id, l);
    } else {
      await createLocationDoc(l.location_id, l);
    }

    return res.status(200).json({ message: 'Location synced successfully' });
  } catch (err) {
    console.error('❌ Location sync error:', err);
    return res.status(500).json({ error: 'Location sync failed' });
  }
};
