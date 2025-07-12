import { createRegistrationDoc, updateRegistrationDoc } from '../../models/registrationModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const collection = db.collection('registrations');

export const syncRegistrationFromClient = async (req, res) => {
  const r = req.body;

  if (!r.registration_id || !r.user_id || !r.person_name || !r.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = collection.doc(r.registration_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(r.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'registration_id',
          latest_data: serverData,
        });
      }

      await updateRegistrationDoc(r.registration_id, r);
    } else {
      await createRegistrationDoc(r.registration_id, r);
    }

    return res.status(200).json({ message: 'Registration synced successfully' });
  } catch (err) {
    console.error('❌ Registration sync error:', err);
    return res.status(500).json({ error: 'Registration sync failed' });
  }
};

/**
 * Resolves conflicts between client and server registration data
 * @param {Object} clientData - The registration data from the client
 * @param {Object} serverData - The registration data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged registration data
 */
export const resolveRegistrationConflict = (clientData, serverData, strategy = 'merge') => {
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
          person_name: clientData.person_name !== undefined ? clientData.person_name : serverData.person_name,
          age: clientData.age !== undefined ? clientData.age : serverData.age,
          gender: clientData.gender !== undefined ? clientData.gender : serverData.gender,
          contact: clientData.contact !== undefined ? clientData.contact : serverData.contact,
          medical_history: clientData.medical_history !== undefined ? clientData.medical_history : serverData.medical_history,
          location_id: clientData.location_id !== undefined ? clientData.location_id : serverData.location_id,
          status: clientData.status !== undefined ? clientData.status : serverData.status,
          notes: clientData.notes !== undefined ? clientData.notes : serverData.notes,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields that are often updated, consider client changes
          medical_history: mergeTextFields(clientData.medical_history, serverData.medical_history),
          notes: mergeTextFields(clientData.notes, serverData.notes),
          // Status field may have specific progression logic
          status: calculateMostAdvancedRegistrationStatus(clientData.status, serverData.status),
          // Keep server's updated_at as it's newer
          updated_at: serverData.updated_at
        };
      }
  }
};

/**
 * Merges text fields intelligently
 * @param {string} clientText - Text from client
 * @param {string} serverText - Text from server
 * @returns {string} - Merged text
 */
const mergeTextFields = (clientText, serverText) => {
  // If either is undefined or null, return the other
  if (clientText === undefined || clientText === null) return serverText;
  if (serverText === undefined || serverText === null) return clientText;
  
  // If they're the same, return either
  if (clientText === serverText) return serverText;
  
  // If client text contains server text, client likely added to it
  if (clientText.includes(serverText)) return clientText;
  
  // If server text contains client text, server likely added to it
  if (serverText.includes(clientText)) return serverText;
  
  // Otherwise combine them with a separator
  return `${serverText}\n\n[SYNC MERGE] Client update:\n${clientText}`;
};

/**
 * Calculate most advanced registration status between client and server
 * @param {string} clientStatus - Status from client
 * @param {string} serverStatus - Status from server
 * @returns {string} - The most advanced status
 */
const calculateMostAdvancedRegistrationStatus = (clientStatus, serverStatus) => {
  const statusRank = {
    'pending': 1,
    'in_progress': 2,
    'completed': 3,
    'transferred': 4,
    'discharged': 5
  };
  
  // If either status is missing, return the other
  if (!clientStatus) return serverStatus;
  if (!serverStatus) return clientStatus;
  
  // Return the status with higher rank
  return statusRank[clientStatus] > statusRank[serverStatus] ? clientStatus : serverStatus;
};

/**
 * Handles explicit conflict resolution requests from client
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const resolveRegistrationSyncConflict = async (req, res) => {
  try {
    const { registration_id, resolution_strategy } = req.body;
    
    if (!registration_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration ID is required',
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
    const docRef = collection.doc(registration_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Registration not found',
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
    const resolvedData = resolveRegistrationConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateRegistrationDoc(registration_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      registration_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving registration conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
