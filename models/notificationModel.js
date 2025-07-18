import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const notifications = db.collection('notifications');

/**
 * Creates a new notification document in Firestore
 * @param {string} id - The notification ID
 * @param {Object} data - The notification data
 * @returns {Promise} - Firestore write result
 */
export const createNotificationDoc = async (id, data) => {
  return await notifications.doc(id).set({
    notification_id: id,
    user_id: data.user_id,
    title: data.title || '',
    message: data.message,
    type: data.type || 'general',
    entity_type: data.entity_type || null,
    entity_id: data.entity_id || null,
    received_at: data.received_at || admin.firestore.FieldValue.serverTimestamp(),
    read: data.read || 0,
    archived: data.archived || 0,
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp()
  });
};

/**
 * Updates an existing notification document in Firestore
 * @param {string} id - The notification ID
 * @param {Object} data - The updated notification data
 * @returns {Promise} - Firestore write result
 */
export const updateNotificationDoc = async (id, data) => {
  const updateData = {};
  
  // Only update fields that are provided
  if (data.user_id !== undefined) updateData.user_id = data.user_id;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.message !== undefined) updateData.message = data.message;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.entity_type !== undefined) updateData.entity_type = data.entity_type;
  if (data.entity_id !== undefined) updateData.entity_id = data.entity_id;
  if (data.received_at !== undefined) updateData.received_at = data.received_at;
  if (data.read !== undefined) updateData.read = data.read;
  if (data.archived !== undefined) updateData.archived = data.archived;
  
  // Always update the updated_at timestamp
  updateData.updated_at = admin.firestore.FieldValue.serverTimestamp();
  
  return await notifications.doc(id).update(updateData);
};

/**
 * Marks a notification as read
 * @param {string} id - The notification ID
 * @returns {Promise} - Firestore write result
 */
export const markNotificationAsRead = async (id) => {
  return await notifications.doc(id).update({
    read: 1,
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
};

/**
 * Marks a notification as archived
 * @param {string} id - The notification ID
 * @returns {Promise} - Firestore write result
 */
export const archiveNotification = async (id) => {
  return await notifications.doc(id).update({
    archived: 1,
    updated_at: admin.firestore.FieldValue.serverTimestamp()
  });
};

/**
 * Deletes a notification document
 * @param {string} id - The notification ID
 * @returns {Promise} - Firestore delete result
 */
export const deleteNotification = async (id) => {
  return await notifications.doc(id).delete();
};

/**
 * Gets a notification by ID
 * @param {string} id - The notification ID
 * @returns {Promise<Object|null>} - The notification document or null if not found
 */
export const getNotificationById = async (id) => {
  const doc = await notifications.doc(id).get();
  return doc.exists ? doc.data() : null;
};

/**
 * Gets all notifications for a user
 * @param {string} userId - The user ID
 * @param {boolean} includeArchived - Whether to include archived notifications
 * @returns {Promise<Array>} - Array of notification documents
 */
export const getNotificationsByUserId = async (userId, includeArchived = false) => {
  let query = notifications.where('user_id', '==', userId);
  
  if (!includeArchived) {
    query = query.where('archived', '==', 0);
  }
  
  const snapshot = await query.orderBy('received_at', 'desc').get();
  return snapshot.docs.map(doc => doc.data());
};

/**
 * Gets unread notifications for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} - Array of unread notification documents
 */
export const getUnreadNotificationsByUserId = async (userId) => {
  const snapshot = await notifications
    .where('user_id', '==', userId)
    .where('read', '==', 0)
    .where('archived', '==', 0)
    .orderBy('received_at', 'desc')
    .get();
  
  return snapshot.docs.map(doc => doc.data());
};

/**
 * Sends a notification to multiple users
 * @param {Array<string>} userIds - Array of user IDs to receive the notification
 * @param {Object} notificationData - The notification data without user_id
 * @returns {Promise<Array>} - Array of promises for each notification created
 */
export const sendNotificationToUsers = async (userIds, notificationData) => {
  const batch = db.batch();
  const notificationPromises = [];
  
  for (const userId of userIds) {
    const notificationId = admin.firestore().collection('notifications').doc().id;
    const notificationWithUser = {
      ...notificationData,
      user_id: userId,
      notification_id: notificationId
    };
    
    notificationPromises.push(
      createNotificationDoc(notificationId, notificationWithUser)
    );
  }
  
  return Promise.all(notificationPromises);
};
