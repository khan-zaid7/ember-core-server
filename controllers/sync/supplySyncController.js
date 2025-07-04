import { createSupplyDoc, updateSupplyDoc } from '../../models/supplyModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('supplies');

export const syncSupplyFromClient = async (req, res) => {
  const s = req.body;

  if (!s.supply_id || !s.user_id || !s.item_name || !s.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = col.doc(s.supply_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(s.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'supply_id',
          latest_data: serverData,
        });
      }

      await updateSupplyDoc(s.supply_id, s);
    } else {
      await createSupplyDoc(s.supply_id, s);
    }

    return res.status(200).json({ message: 'Supply synced successfully' });
  } catch (err) {
    console.error('❌ Supply sync error:', err);
    return res.status(500).json({ error: 'Supply sync failed' });
  }
};
