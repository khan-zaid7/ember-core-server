import { createTaskDoc, updateTaskDoc } from '../../models/taskModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('tasks');

export const syncTaskFromClient = async (req, res) => {
  const t = req.body;

  if (!t.task_id || !t.title || !t.created_by || !t.updated_at) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check for task title uniqueness within the same location if location is provided
    if (t.title && t.location_id) {
      const titleQuery = col
        .where('title', '==', t.title)
        .where('location_id', '==', t.location_id);
      
      const existingTitle = await titleQuery.get();
      
      if (!existingTitle.empty && existingTitle.docs[0].id !== t.task_id) {
        return res.status(409).json({
          error: 'Conflict: Task with this title already exists at the same location',
          conflict_field: 'title',
          conflict_type: 'unique_constraint',
          latest_data: existingTitle.docs[0].data(),
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
        });
      }
    }
    
    const docRef = col.doc(t.task_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(t.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
          client_id: t.task_id,
          server_id: t.task_id, // Same ID for stale updates
        });
      }

      await updateTaskDoc(t.task_id, t);
    } else {
      await createTaskDoc(t.task_id, t);
    }

    return res.status(200).json({ message: 'Task synced successfully' });
  } catch (err) {
    console.error('❌ Task sync error:', err);
    return res.status(500).json({ error: 'Task sync failed' });
  }
};

/**
 * Resolves conflicts between client and server task data
 * @param {Object} clientData - The task data from the client
 * @param {Object} serverData - The task data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged task data
 */
export const resolveTaskConflict = (clientData, serverData, strategy = 'merge') => {
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
          title: clientData.title !== undefined ? clientData.title : serverData.title,
          description: clientData.description !== undefined ? clientData.description : serverData.description,
          priority: clientData.priority !== undefined ? clientData.priority : serverData.priority,
          due_date: clientData.due_date !== undefined ? clientData.due_date : serverData.due_date,
          status: clientData.status !== undefined ? clientData.status : serverData.status,
          location_id: clientData.location_id !== undefined ? clientData.location_id : serverData.location_id,
          // Use client's updated_at since it's newer
          updated_at: clientData.updated_at
        };
      } else {
        // Server data is newer or timestamps are equal - prioritize server but consider client changes
        return {
          ...serverData,
          // For content fields, only use client values if they've been explicitly changed
          title: clientData.title !== undefined && clientData.title !== serverData.title ? 
                clientData.title : serverData.title,
          description: clientData.description !== undefined && clientData.description !== serverData.description ? 
                clientData.description : serverData.description,
          // Status field typically progresses forward (not backwards), so take the most advanced state
          status: calculateMostAdvancedStatus(clientData.status, serverData.status),
          // Keep server's updated_at as it's newer
          updated_at: serverData.updated_at
        };
      }
  }
};

/**
 * Calculate most advanced status between client and server
 * @param {string} clientStatus - Status from client
 * @param {string} serverStatus - Status from server
 * @returns {string} - The most advanced status
 */
const calculateMostAdvancedStatus = (clientStatus, serverStatus) => {
  const statusRank = {
    'todo': 1,
    'in_progress': 2,
    'review': 3,
    'completed': 4,
    'cancelled': 5
  };
  
  // If either status is missing, return the other
  if (!clientStatus) return serverStatus;
  if (!serverStatus) return clientStatus;
  
  // Return the status with higher rank
  return statusRank[clientStatus] > statusRank[serverStatus] ? clientStatus : serverStatus;
};

/**
 * Handles explicit conflict resolution requests from client, with allowed_strategies and resolution_strategy echoed.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const resolveTaskSyncConflict = async (req, res) => {
  try {
    const { task_id, resolution_strategy, clientData } = req.body;
    
    if (!task_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Task ID is required',
        status: 'error',
        allowed_strategies: [],
      });
    }

    const allowed_strategies = [];
    const docRef = col.doc(task_id);
    const doc = await docRef.get();

    let resolvedData;
    let isNewTask = false;

    if (!doc.exists) {
      isNewTask = true;
      allowed_strategies.push('client_wins');

      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new task - no server data exists`,
          status: 'error',
          allowed_strategies,
        });
      }

      resolvedData = { ...clientData };
    } else {
      allowed_strategies.push('client_wins', 'server_wins', 'merge', 'update_data');
      const serverData = doc.data();

      if (!clientData) {
        return res.status(400).json({
          success: false,
          message: 'Client data is required',
          status: 'error',
          allowed_strategies,
        });
      }

      if (!allowed_strategies.includes(resolution_strategy)) {
        return res.status(400).json({
          success: false,
          message: `Strategy "${resolution_strategy}" is not allowed for this conflict.`,
          status: 'error',
          allowed_strategies,
        });
      }

      resolvedData = resolveTaskConflict(clientData, serverData, resolution_strategy);
    }

    if (isNewTask) {
      await createTaskDoc(task_id, resolvedData);
    } else {
      await updateTaskDoc(task_id, resolvedData);
    }

    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy${isNewTask ? ' (new task created)' : ' (existing task updated)'}`,
      status: 'resolved',
      task_id,
      resolvedData,
      isNewTask,
      resolution_strategy,
      allowed_strategies,
      client_id: task_id,
      server_id: task_id, // For tasks, IDs should match after resolution
    });
  } catch (error) {
    console.error('Error resolving task conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error',
      allowed_strategies: [],
    });
  }
};
