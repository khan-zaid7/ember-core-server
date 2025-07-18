import admin from '../config/firebaseAdmin.js';

// Helper function to safely convert a value to an ISO 8601 string.
export const toISOStringSafe = (value) => {
    if (value instanceof admin.firestore.Timestamp) {
        return value.toDate().toISOString();
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return null;
};