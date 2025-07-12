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

/**
 * Resolves conflicts between client and server supply data
 * @param {Object} clientData - The supply data from the client
 * @param {Object} serverData - The supply data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged supply data
 */
export const resolveSupplyConflict = (clientData, serverData, strategy = 'merge') => {
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
          item_name: clientData.item_name !== undefined ? clientData.item_name : serverData.item_name,
          category: clientData.category !== undefined ? clientData.category : serverData.category,
          quantity: clientData.quantity !== undefined ? clientData.quantity : serverData.quantity,
          unit: clientData.unit !== undefined ? clientData.unit : serverData.unit,
          location_id: clientData.location_id !== undefined ? clientData.location_id : serverData.location_id,
          expiry_date: clientData.expiry_date !== undefined ? clientData.expiry_date : serverData.expiry_date,
          notes: clientData.notes !== undefined ? clientData.notes : serverData.notes,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields, only use client values if they've been explicitly changed
          notes: clientData.notes !== undefined && clientData.notes !== serverData.notes ? 
                clientData.notes : serverData.notes,
          // For quantity, special handling - take the lower value to prevent over-allocation
          quantity: Math.min(
            clientData.quantity !== undefined ? clientData.quantity : Number.MAX_SAFE_INTEGER, 
            serverData.quantity !== undefined ? serverData.quantity : Number.MAX_SAFE_INTEGER
          ),
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
export const resolveSupplySyncConflict = async (req, res) => {
  try {
    const { supply_id, resolution_strategy } = req.body;
    
    if (!supply_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Supply ID is required',
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
    const docRef = col.doc(supply_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Supply not found',
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
    const resolvedData = resolveSupplyConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateSupplyDoc(supply_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      supply_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving supply conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
