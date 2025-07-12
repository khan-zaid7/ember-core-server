import { createNotificationDoc, updateNotificationDoc, getNotificationById } from '../../models/notificationModel.js';

/**
 * Syncs notification data from client to server
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const syncNotificationFromClient = async (req, res) => {
  try {
    const result = await handleNotificationSync(req.body);
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error in notification sync endpoint:', error);
    res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};

/**
 * Handle notification sync from client to server
 * @param {Object} data - The notification data from the client
 * @returns {Object} - Response containing sync results
 */
export const handleNotificationSync = async (data) => {
  try {
    const { notification_id } = data;
    
    if (!notification_id) {
      return { 
        success: false, 
        message: 'Notification ID is required',
        status: 'error'
      };
    }
    
    // Check if notification exists
    const existingNotification = await getNotificationById(notification_id);
    
    if (existingNotification) {
      // Handle potential conflicts
      const clientUpdatedAt = data.updated_at ? new Date(data.updated_at) : null;
      const serverUpdatedAt = existingNotification.updated_at ? 
        (existingNotification.updated_at.toDate ? existingNotification.updated_at.toDate() : new Date(existingNotification.updated_at)) : 
        null;
      
      // Check if we need to handle a conflict
      if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt < serverUpdatedAt) {
        // Server has newer data, this is a conflict
        // Instead of just rejecting, intelligently merge the data
        const mergedData = resolveNotificationConflict(data, existingNotification, 'merge');
        
        // Update with the merged data
        await updateNotificationDoc(notification_id, mergedData);
        
        return {
          success: true,
          message: 'Conflict resolved: Data merged',
          status: 'resolved',
          notification_id,
          serverData: existingNotification,
          clientData: data,
          mergedData,
          resolution: 'merge'
        };
      }
      
      // If no conflict or client data is newer, update notification
      await updateNotificationDoc(notification_id, data);
      return {
        success: true,
        message: 'Notification updated successfully',
        status: 'updated',
        notification_id
      };
    } else {
      // Create new notification
      await createNotificationDoc(notification_id, data);
      return {
        success: true,
        message: 'Notification created successfully',
        status: 'created',
        notification_id
      };
    }
  } catch (error) {
    console.error('Error syncing notification:', error);
    return {
      success: false,
      message: `Error syncing notification: ${error.message}`,
      status: 'error'
    };
  }
};

/**
 * Resolves conflicts between client and server notification data
 * @param {Object} clientData - The notification data from the client
 * @param {Object} serverData - The notification data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged notification data
 */
export const resolveNotificationConflict = (clientData, serverData, strategy = 'merge') => {
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
      // If client data is newer (despite initial conflict detection), respect client's changes
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
          title: clientData.title !== undefined ? clientData.title : serverData.title,
          type: clientData.type !== undefined ? clientData.type : serverData.type,
          entity_type: clientData.entity_type !== undefined ? clientData.entity_type : serverData.entity_type,
          entity_id: clientData.entity_id !== undefined ? clientData.entity_id : serverData.entity_id,
          // Use client values for state fields
          read: clientData.read !== undefined ? clientData.read : serverData.read,
          archived: clientData.archived !== undefined ? clientData.archived : serverData.archived,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields, only use client values if they've been explicitly changed
          // This preserves intentional deletions (empty strings, nulls) from the client
          message: clientData.message !== undefined && clientData.message !== serverData.message ? 
                  clientData.message : serverData.message,
          title: clientData.title !== undefined && clientData.title !== serverData.title ? 
                clientData.title : serverData.title,
          // For state fields, use the most advanced state from either side
          read: Math.max(clientData.read || 0, serverData.read || 0),
          archived: Math.max(clientData.archived || 0, serverData.archived || 0),
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
export const resolveNotificationSyncConflict = async (req, res) => {
  try {
    const { notification_id, resolution_strategy } = req.body;
    
    if (!notification_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Notification ID is required',
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
    const docRef = col.doc(notification_id);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
        status: 'error'
      });
    }
    
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
    const resolvedData = resolveNotificationConflict(clientData, serverData, resolution_strategy);
    
    // Update with resolved data
    await updateNotificationDoc(notification_id, resolvedData);
    
    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy`,
      status: 'resolved',
      notification_id,
      resolvedData
    });
  } catch (error) {
    console.error('Error resolving notification conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error'
    });
  }
};
