import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const tasks = db.collection('tasks');

export const createTaskDoc = async (id, data) => {
  return await tasks.doc(id).set({
    task_id: id,
    title: data.title,
    description: data.description || '',
    status: data.status || 'pending',
    priority: data.priority || 'normal',
    created_by: data.created_by,
    due_date: data.due_date,
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};


export const updateTaskDoc = async (id, data) => {
  return await tasks.doc(id).update({
    title: data.title,
    description: data.description || '',
    status: data.status || 'pending',
    priority: data.priority || 'normal',
    due_date: data.due_date,
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};