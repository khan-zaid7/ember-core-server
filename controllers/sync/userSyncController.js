// controllers/sync/syncUserFromClient.js
import { createUserDoc, updateUserDoc } from '../../models/userModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const usersCollection = db.collection('users');

export const syncUserFromClient = async (req, res) => {
  const user = req.body;

  if (!user.user_id || !user.name || !user.email || !user.role || !user.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const docRef = usersCollection.doc(user.user_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(user.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
        });
      }

      // Check if email was changed and already exists for another user
      if (user.email !== serverData.email) {
        const existingEmail = await usersCollection.where('email', '==', user.email).get();
        if (!existingEmail.empty && existingEmail.docs[0].id !== user.user_id) {
          return res.status(409).json({
            error: 'Conflict: Email already exists',
            conflict_field: 'email',
            conflict_type: 'unique_constraint',
            latest_data: existingEmail.docs[0].data(),
          });
        }
      }
      
      // Check if phone_number was changed and already exists for another user
      if (user.phone_number && user.phone_number !== serverData.phone_number) {
        const existingPhone = await usersCollection.where('phone_number', '==', user.phone_number).get();
        if (!existingPhone.empty && existingPhone.docs[0].id !== user.user_id) {
          return res.status(409).json({
            error: 'Conflict: Phone number already exists',
            conflict_field: 'phone_number',
            conflict_type: 'unique_constraint',
            latest_data: existingPhone.docs[0].data(),
          });
        }
      }

      // ✅ Safe to update
      await updateUserDoc(user.user_id, user);
    } else {
      // 🔍 Check if another user already exists with this email
      const existingEmail = await usersCollection.where('email', '==', user.email).get();

      if (!existingEmail.empty) {
        const existingUser = existingEmail.docs[0].data();
        return res.status(409).json({
          error: 'Conflict: Email already exists',
          conflict_field: 'email',
          conflict_type: 'unique_constraint',
          latest_data: existingUser,
        });
      }
      
      // 🔍 Check if another user already exists with this phone number
      if (user.phone_number) {
        const existingPhone = await usersCollection.where('phone_number', '==', user.phone_number).get();
        if (!existingPhone.empty) {
          const existingUser = existingPhone.docs[0].data();
          return res.status(409).json({
            error: 'Conflict: Phone number already exists',
            conflict_field: 'phone_number',
            conflict_type: 'unique_constraint',
            latest_data: existingUser,
          });
        }
      }

      // ✅ Safe to create new user
      await createUserDoc(user.user_id, user);
    }

    return res.status(200).json({ message: 'User synced successfully' });
  } catch (err) {
    console.error('❌ User sync error:', err);
    return res.status(500).json({ error: 'User sync failed' });
  }
};

/**
 * Resolves conflicts between client and server user data
 * @param {Object} clientData - The user data from the client
 * @param {Object} serverData - The user data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged user data
 */
export const resolveUserConflict = (clientData, serverData, strategy = 'merge') => {
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
          email: clientData.email !== undefined ? clientData.email : serverData.email,
          role: clientData.role !== undefined ? clientData.role : serverData.role,
          phone: clientData.phone !== undefined ? clientData.phone : serverData.phone,
          profile_image: clientData.profile_image !== undefined ? clientData.profile_image : serverData.profile_image,
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
          phone: clientData.phone !== undefined && clientData.phone !== serverData.phone ? 
                clientData.phone : serverData.phone,
          profile_image: clientData.profile_image !== undefined && clientData.profile_image !== serverData.profile_image ? 
                clientData.profile_image : serverData.profile_image,
          // Don't merge critical fields like email or role through automatic merge
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
export const resolveUserSyncConflict = async (req, res) => {
  try {
    const { user_id, resolution_strategy } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID is required',
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
    const docRef = usersCollection.doc(user_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
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
    const resolvedData = resolveUserConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateUserDoc(user_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      user_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving user conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
