import { createTaskAssignmentDoc, updateTaskAssignmentDoc } from '../../models/taskAssignmentModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('task_assignments');

export const syncTaskAssignmentFromClient = async (req, res) => {
  const a = req.body;

  if (!a.assignment_id || !a.task_id || !a.user_id || !a.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = col.doc(a.assignment_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(a.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'assignment_id',
          latest_data: serverData,
        });
      }

      await updateTaskAssignmentDoc(a.assignment_id, a);
    } else {
      await createTaskAssignmentDoc(a.assignment_id, a);
    }

    return res.status(200).json({ message: 'Task Assignment synced successfully' });
  } catch (err) {
    console.error('❌ Task Assignment sync error:', err);
    return res.status(500).json({ error: 'Task Assignment sync failed' });
  }
};
