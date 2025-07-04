import { createAlertDoc, updateAlertDoc } from '../../models/alertModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('alerts');

export const syncAlertFromClient = async (req, res) => {
  const alert = req.body;

  if (!alert.alert_id || !alert.user_id || !alert.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = col.doc(alert.alert_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(alert.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'alert_id',
          latest_data: serverData,
        });
      }

      await updateAlertDoc(alert.alert_id, alert);
    } else {
      await createAlertDoc(alert.alert_id, alert);
    }

    return res.status(200).json({ message: 'Alert synced successfully' });
  } catch (err) {
    console.error('❌ Alert sync error:', err);
    return res.status(500).json({ error: 'Alert sync failed' });
  }
};
