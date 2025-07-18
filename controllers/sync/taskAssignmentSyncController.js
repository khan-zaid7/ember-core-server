import { createTaskAssignmentDoc, updateTaskAssignmentDoc } from '../../models/taskAssignmentModel.js';
import admin from '../../config/firebaseAdmin.js';

const db = admin.firestore();
const col = db.collection('task_assignments');

export const syncTaskAssignmentFromClient = async (req, res) => {
  const a = req.body;

  if (!a.assignment_id || !a.task_id || !a.user_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if the user is already assigned to this task (in a different assignment)
    const duplicateQuery = col
      .where('task_id', '==', a.task_id)
      .where('user_id', '==', a.user_id);
    
    const duplicateAssignments = await duplicateQuery.get();
    
    if (!duplicateAssignments.empty && duplicateAssignments.docs[0].id !== a.assignment_id) {
      return res.status(409).json({
        error: 'Conflict: User is already assigned to this task',
        conflict_field: 'task_id_user_id',
        conflict_type: 'unique_constraint',
        latest_data: duplicateAssignments.docs[0].data(),
        allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
      });
    }
    
    const docRef = col.doc(a.assignment_id);
    const doc = await docRef.get();

    if (doc.exists) {
      const serverData = doc.data();
      const serverUpdated = new Date(serverData.updated_at);
      const clientUpdated = new Date(a.updated_at);

      if (clientUpdated < serverUpdated) {
        return res.status(409).json({
          error: 'Conflict: Stale update',
          conflict_field: 'updated_at',
          latest_data: serverData,
          allowed_strategies: ['client_wins', 'server_wins', 'merge', 'update_data'],
          client_id: a.assignment_id,
          server_id: a.assignment_id, // Same ID for stale updates
        });
      }

      await updateTaskAssignmentDoc(a.assignment_id, a);
    } else {
      await createTaskAssignmentDoc(a.assignment_id, a);
    }

    return res.status(200).json({ message: 'Task Assignment synced successfully' });
  } catch (err) {
    console.error('❌ Task Assignment sync error:', err);
    return res.status(500).json({ error: 'Task Assignment sync failed' });
  }
};

/**
 * Resolves conflicts between client and server task assignment data
 * @param {Object} clientData - The task assignment data from the client
 * @param {Object} serverData - The task assignment data from the server
 * @param {string} strategy - The conflict resolution strategy ('client_wins', 'server_wins', 'merge')
 * @returns {Object} - Merged task assignment data
 */
export const resolveTaskAssignmentConflict = (clientData, serverData, strategy = 'merge') => {
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
          status: clientData.status !== undefined ? clientData.status : serverData.status,
          notes: clientData.notes !== undefined ? clientData.notes : serverData.notes,
          completed_at: clientData.completed_at !== undefined ? clientData.completed_at : serverData.completed_at,
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
          // Status field typically progresses forward (not backwards), so take the most advanced state
          status: calculateMostAdvancedAssignmentStatus(clientData.status, serverData.status),
          // Keep server's updated_at as it's newer
          updated_at: serverData.updated_at
        };
      }
  }
};

/**
 * Calculate most advanced assignment status between client and server
 * @param {string} clientStatus - Status from client
 * @param {string} serverStatus - Status from server
 * @returns {string} - The most advanced status
 */
const calculateMostAdvancedAssignmentStatus = (clientStatus, serverStatus) => {
  const statusRank = {
    'assigned': 1,
    'accepted': 2,
    'in_progress': 3,
    'completed': 4,
    'rejected': 5
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
export const resolveTaskAssignmentSyncConflict = async (req, res) => {
  try {
    const { assignment_id, resolution_strategy, clientData } = req.body;
    
    if (!assignment_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Assignment ID is required',
        status: 'error',
        allowed_strategies: [],
      });
    }

    const allowed_strategies = [];
    const docRef = col.doc(assignment_id);
    const doc = await docRef.get();

    let resolvedData;
    let isNewAssignment = false;

    if (!doc.exists) {
      isNewAssignment = true;
      allowed_strategies.push('client_wins');

      if (resolution_strategy === 'server_wins' || resolution_strategy === 'update_data') {
        return res.status(400).json({
          success: false,
          message: `Cannot use ${resolution_strategy} strategy for new assignment - no server data exists`,
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

      resolvedData = resolveTaskAssignmentConflict(clientData, serverData, resolution_strategy);
    }

    if (isNewAssignment) {
      await createTaskAssignmentDoc(assignment_id, resolvedData);
    } else {
      await updateTaskAssignmentDoc(assignment_id, resolvedData);
    }

    return res.status(200).json({
      success: true,
      message: `Conflict resolved using ${resolution_strategy} strategy${isNewAssignment ? ' (new assignment created)' : ' (existing assignment updated)'}`,
      status: 'resolved',
      assignment_id,
      resolvedData,
      isNewAssignment,
      resolution_strategy,
      allowed_strategies,
      client_id: assignment_id,
      server_id: assignment_id, // For assignments, IDs should match after resolution
    });
  } catch (error) {
    console.error('Error resolving task assignment conflict:', error);
    return res.status(500).json({
      success: false,
      message: `Server error: ${error.message}`,
      status: 'error',
      allowed_strategies: [],
    });
  }
};
