import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const assignments = db.collection('task_assignments');

export const createTaskAssignmentDoc = async (id, data) => {
  return await assignments.doc(id).set({
    assignment_id: id,
    task_id: data.task_id,
    user_id: data.user_id,
    assigned_at: data.assigned_at,
    status: data.status || 'assigned',
    feedback: data.feedback || '',
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const updateTaskAssignmentDoc = async (id, data) => {
  return await assignments.doc(id).update({
    task_id: data.task_id,
    user_id: data.user_id,
    assigned_at: data.assigned_at,
    status: data.status || 'assigned',
    feedback: data.feedback || '',
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};