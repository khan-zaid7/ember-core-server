import { createLocationDoc, updateLocationDoc } from '../../models/locationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('locations');

export const syncLocationFromClient = async (req, res) => {
  const l = req.body;

  if (!l.location_id || !l.user_id || !l.name || !l.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check for location name uniqueness if provided
    if (l.name) {
      const nameQuery = col.where('name', '==', l.name);
      const existingName = await nameQuery.get();
      
      if (!existingName.empty && existingName.docs[0].id !== l.location_id) {
        return res.status(409).json({
          error: 'Conflict: Location with this name already exists',
          conflict_field: 'name',
          conflict_type: 'unique_constraint',
          latest_data: existingName.docs[0].data(),
        });
      }
    }
    
    const docRef = col.doc(l.location_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const clientUpdatedAt = new Date(l.updated_at);
      const serverUpdatedAt = new Date(serverData.updated_at);

      if (clientUpdatedAt < serverUpdatedAt) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'location_id',
          latest_data: serverData,
        });
      }

      await updateLocationDoc(l.location_id, l);
    } else {
      await createLocationDoc(l.location_id, l);
    }

    return res.status(200).json({ message: 'Location synced successfully' });
  } catch (err) {
    console.error('❌ Location sync error:', err);
    return res.status(500).json({ error: 'Location sync failed' });
  }
};

/**
 * Resolves conflicts between client and server location data
 * @param {Object} clientData - The location data from the client
 * @param {Object} serverData - The location data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged location data
 */
export const resolveLocationConflict = (clientData, serverData, strategy = 'merge') => {
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
          name: clientData.name !== undefined ? clientData.name : serverData.name,
          address: clientData.address !== undefined ? clientData.address : serverData.address,
          latitude: clientData.latitude !== undefined ? clientData.latitude : serverData.latitude,
          longitude: clientData.longitude !== undefined ? clientData.longitude : serverData.longitude,
          type: clientData.type !== undefined ? clientData.type : serverData.type,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields, only use client values if they've been explicitly changed
          name: clientData.name !== undefined && clientData.name !== serverData.name ? 
                clientData.name : serverData.name,
          address: clientData.address !== undefined && clientData.address !== serverData.address ? 
                clientData.address : serverData.address,
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
export const resolveLocationSyncConflict = async (req, res) => {
  try {
    const { location_id, resolution_strategy } = req.body;
    
    if (!location_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Location ID is required',
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
    const docRef = col.doc(location_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Location not found',
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
    const resolvedData = resolveLocationConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateLocationDoc(location_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      location_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving location conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
