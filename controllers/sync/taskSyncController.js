import { createTaskDoc, updateTaskDoc } from '../../models/taskModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('tasks');

export const syncTaskFromClient = async (req, res) => {
  const t = req.body;

  if (!t.task_id || !t.title || !t.created_by || !t.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = col.doc(t.task_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(t.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'task_id',
          latest_data: serverData,
        });
      }

      await updateTaskDoc(t.task_id, t);
    } else {
      await createTaskDoc(t.task_id, t);
    }

    return res.status(200).json({ message: 'Task synced successfully' });
  } catch (err) {
    console.error('❌ Task sync error:', err);
    return res.status(500).json({ error: 'Task sync failed' });
  }
};
