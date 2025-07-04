import admin from '../config/firebaseAdmin.js';
const db = admin.firestore();
const supplies = db.collection('supplies');

export const createSupplyDoc = async (id, data) => {
  return await supplies.doc(id).set({
    supply_id: id,
    user_id: data.user_id,
    item_name: data.item_name,
    quantity: data.quantity,
    expiry_date: data.expiry_date,
    location_id: data.location_id,
    timestamp: data.timestamp,
    synced: true,
    status: data.status || 'active',
  });
};

export const updateSupplyDoc = async (id, data) => {
  return await supplies.doc(id).update({
    item_name: data.item_name,
    quantity: data.quantity,
    expiry_date: data.expiry_date,
    location_id: data.location_id,
    timestamp: data.timestamp || admin.firestore.FieldValue.serverTimestamp(),
    status: data.status || 'active',
    synced: true,
  });
};