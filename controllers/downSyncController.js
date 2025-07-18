// controllers/downSyncController.js (or userController.js)

import admin from '../config/firebaseAdmin.js';
import { toISOStringSafe } from '../config/toISOString.js';

const db = admin.firestore();

// Define collection references using the local 'db' instance
const usersCollection = db.collection('users');
const locationsCollection = db.collection('locations');
const tasksCollection = db.collection('tasks'); 
const suppliesCollection = db.collection('supplies');
const registrationsCollection = db.collection('registrations'); 


/**
 * @route GET /api/users/:userId
 * @desc Get a user's profile data by their user_id.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getUserDataById = async (req, res) => {
    const { userId } = req.params;

    try {
        const userDoc = await usersCollection.doc(userId).get();

        if (!userDoc.exists) {
            return res.status(404).json({ message: 'User not found.' });
        }

        let userData = userDoc.data();

        if (userData.password) {
            delete userData.password;
        }

        const formattedUserData = {
            ...userData,
            created_at: toISOStringSafe(userData.created_at),
            updated_at: toISOStringSafe(userData.updated_at),
        };

        return res.status(200).json({
            message: 'User data retrieved successfully',
            user: formattedUserData
        });

    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ message: 'Failed to retrieve user data.' });
    }
};

/**
 * @route GET /api/locations
 * @desc Get all documents from the 'locations' collection.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getAllLocations = async (req, res) => {
    try {
        const snapshot = await locationsCollection.get();
        const allLocations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return res.status(200).json({
            message: 'Locations retrieved successfully',
            locations: allLocations
        });
    } catch (error) {
        console.error("Error getting all locations:", error);
        res.status(500).json({ message: "Failed to retrieve all locations." });
    }
};

/**
 * @route GET /api/tasks/by-user/:userId
 * @desc Get all tasks assigned to or created by a specific user.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
/**
 * @route GET /api/tasks/created-by/:userId
 * @desc Get all tasks created by a specific user.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getAllTasksForUser = async (req, res) => { // Renaming suggested for clarity in route
    const { userId } = req.params;

    try {
        // Query ONLY for tasks where 'created_by' matches userId
        const createdTasksSnapshot = await tasksCollection.where('created_by', '==', userId).get();

        const allTasks = createdTasksSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            created_at: toISOStringSafe(doc.data().created_at),
            updated_at: toISOStringSafe(doc.data().updated_at),
            due_date: toISOStringSafe(doc.data().due_date),
        }));

        return res.status(200).json({
            message: 'Tasks created by user retrieved successfully',
            tasks: allTasks
        });
    } catch (error) {
        console.error("Error getting tasks created by user:", error);
        res.status(500).json({ message: "Failed to retrieve tasks created by user." });
    }
};

/**
 * @route GET /api/task-assignments/by-user/:userId
 * @desc Get all task assignments and their tasks for a specific user
 * @access Private
 */
export const getTaskAssignmentsForUser = async (req, res) => {
  const { userId } = req.params;

  try {
    const assignmentsSnapshot = await db
      .collection('task_assignments')
      .where('user_id', '==', userId)
      .get();

    const assignments = [];

    for (const doc of assignmentsSnapshot.docs) {
      const assignmentData = doc.data();

      // Fetch corresponding task (if it exists)
      let task = null;
      if (assignmentData.task_id) {
        const taskSnapshot = await db.collection('tasks').doc(assignmentData.task_id).get();
        if (taskSnapshot.exists) {
          const taskData = taskSnapshot.data();
          task = {
            task_id: taskSnapshot.id,
            ...taskData,
            created_at: toISOStringSafe(taskData.created_at),
            updated_at: toISOStringSafe(taskData.updated_at),
          };
        }
      }

      // Push formatted task assignment
      assignments.push({
        assignment_id: doc.id,
        ...assignmentData,
        assigned_at: toISOStringSafe(assignmentData.assigned_at),
        created_at: toISOStringSafe(assignmentData.created_at),
        updated_at: toISOStringSafe(assignmentData.updated_at),
        task: task || null,
      });
    }

    return res.status(200).json({
      message: 'Task assignments retrieved successfully',
      assignments, // ✅ This matches the client's `response.data.assignments`
    });
  } catch (error) {
    console.error('❌ Error fetching task assignments with tasks:', error);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
};
/**
 * @route GET /api/supplies
 * @desc Get all documents from the 'supplies' collection.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getAllSupplies = async (req, res) => { // NEW controller function
    try {
        const snapshot = await suppliesCollection.get(); // Use suppliesCollection defined in this file

        const allSupplies = snapshot.docs.map(doc => ({
            id: doc.id, // Include the document ID
            ...doc.data(),
            // Ensure timestamps/dates are formatted
            expiry_date: toISOStringSafe(doc.data().expiry_date), // Assuming expiry_date can be a Timestamp
            timestamp: toISOStringSafe(doc.data().timestamp),       // Assuming timestamp can be a Timestamp
            created_at: toISOStringSafe(doc.data().created_at),
            updated_at: toISOStringSafe(doc.data().updated_at),
        }));

        return res.status(200).json({
            message: 'Supplies retrieved successfully',
            supplies: allSupplies
        });
    } catch (error) {
        console.error("Error getting all supplies:", error);
        res.status(500).json({ message: "Failed to retrieve all supplies." });
    }
};

/**
 * @route GET /api/registrations/by-user/:userId
 * @desc Get all registered patients associated with a specific user.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getRegisteredPatientsForUser = async (req, res) => { // NEW controller function
    const { userId } = req.params;

    try {
        const snapshot = await registrationsCollection.where('user_id', '==', userId).get();

        const allRegistrations = snapshot.docs.map(doc => ({
            id: doc.id, // Include the document ID
            ...doc.data(),
            // Ensure timestamps/dates are formatted
            timestamp: toISOStringSafe(doc.data().timestamp),
            created_at: toISOStringSafe(doc.data().created_at),
            updated_at: toISOStringSafe(doc.data().updated_at),
        }));

        return res.status(200).json({
            message: 'Registered patients retrieved successfully',
            patients: allRegistrations // Naming it 'patients' as per your initial request
        });
    } catch (error) {
        console.error("Error getting registered patients for user:", error);
        res.status(500).json({ message: "Failed to retrieve registered patients." });
    }
};


/**
 * @route GET /api/users/fieldworkers
 * @desc Get all users where role is 'fieldworker'.
 * @access Private (You should implement authentication/authorization middleware before this route)
 */
export const getAllFieldworkers = async (req, res) => {
  try {
    console.log('this method is working? ')
    const snapshot = await usersCollection.where('role', '==', 'fieldworker').get();

    if (snapshot.empty) {
      return res.status(200).json({
        message: 'No fieldworkers found',
        users: []
      });
    }

    const fieldworkers = snapshot.docs.map(doc => {
      const data = doc.data();
      if (data.password) {
        delete data.password; // remove sensitive info
      }
      return {
        id: doc.id,
        ...data,
        created_at: toISOStringSafe(data.created_at),
        updated_at: toISOStringSafe(data.updated_at),
      };
    });

    return res.status(200).json({
      message: 'Fieldworkers retrieved successfully',
      users: fieldworkers
    });
  } catch (error) {
    console.error('Error fetching fieldworkers:', error);
    return res.status(500).json({ message: 'Failed to retrieve fieldworkers.' });
  }
};
