// routes/downSyncRoutes.js

import express from 'express';
// Import all functions from the controller
import {
    getUserDataById,
    getAllLocations,
    getAllTasksForUser,
    getTaskAssignmentsForUser,
    getAllSupplies,
    getRegisteredPatientsForUser,
    getAllFieldworkers
} from '../controllers/downSyncController.js'; 

const router = express.Router();

// user-specific data
router.get('/users/field-workers', getAllFieldworkers);

router.get('/users/:userId', getUserDataById);
router.get('/tasks/created-by/:userId', getAllTasksForUser);
router.get('/task-assignments/by-user/:userId', getTaskAssignmentsForUser);
router.get('/registrations/by-user/:userId', getRegisteredPatientsForUser); // 

// comman data 
router.get('/locations', getAllLocations);
router.get('/supplies', getAllSupplies);

export default router;