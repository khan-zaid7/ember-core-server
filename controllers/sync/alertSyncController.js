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

/**
 * Resolves conflicts between client and server alert data
 * @param {Object} clientData - The alert data from the client
 * @param {Object} serverData - The alert data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged alert data
 */
export const resolveAlertConflict = (clientData, serverData, strategy = 'merge') => {
  switch (strategy) {
    case 'client_wins':
      // Client data takes precedence
      return { ...clientData };
      
    case 'server_wins':
      // Server data takes precedence
      return { ...serverData };
      
    case 'merge':
    default:
      // Intelligently merge data based on timestamps
      const clientUpdatedAt = clientData.updated_at ? new Date(clientData.updated_at) : null;
      const serverUpdatedAt = serverData.updated_at ? 
        (serverData.updated_at.toDate ? serverData.updated_at.toDate() : new Date(serverData.updated_at)) : 
        null;
        
      // If client data is newer, respect client's intentional field changes
      if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt > serverUpdatedAt) {
        return {
          ...serverData,
          // Always use client values for these fields even if null/empty
          message: clientData.message !== undefined ? clientData.message : serverData.message,
          severity: clientData.severity !== undefined ? clientData.severity : serverData.severity,
          location_id: clientData.location_id !== undefined ? clientData.location_id : serverData.location_id,
          is_active: clientData.is_active !== undefined ? clientData.is_active : serverData.is_active,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields, only use client values if they've been explicitly changed
          message: clientData.message !== undefined && clientData.message !== serverData.message ? 
                clientData.message : serverData.message,
          is_active: clientData.is_active !== undefined ? 
                Math.max(clientData.is_active ? 1 : 0, serverData.is_active ? 1 : 0) : serverData.is_active,
          // Keep server's updated_at as it's newer
          updated_at: serverData.updated_at
        };
      }
  }
};

/**
 * Handles explicit conflict resolution requests from client
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const resolveAlertSyncConflict = async (req, res) => {
  try {
    const { alert_id, resolution_strategy } = req.body;
    
    if (!alert_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Alert ID is required',
        status: 'error'
      });
    }
    
    if (!['client_wins', 'server_wins', 'merge'].includes(resolution_strategy)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resolution strategy. Must be one of: client_wins, server_wins, merge',
        status: 'error'
      });
    }
    
    // Get current server data
    const docRef = col.doc(alert_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Alert not found',
        status: 'error'
      });
    }
    
    const serverData = doc.data();
    
    // Get client data from request
    const clientData = req.body.clientData;
    
    if (!clientData) {
      return res.status(400).json({
        success: false,
        message: 'Client data is required',
        status: 'error'
      });
    }
    
    // Apply requested resolution strategy
    const resolvedData = resolveAlertConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateAlertDoc(alert_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      alert_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving alert conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
