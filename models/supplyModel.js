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
    barcode: data.barcode || null,
    sku: data.sku || null,
    created_at: data.created_at || admin.firestore.FieldValue.serverTimestamp(),
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
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
    barcode: data.barcode || null,
    sku: data.sku || null,
    updated_at: data.updated_at || admin.firestore.FieldValue.serverTimestamp(),
  });
};