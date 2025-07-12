// routes/syncRoutes.js
import express from 'express';
import {
  syncUserFromClient,
  syncRegistrationFromClient,
  syncSupplyFromClient,
  syncTaskFromClient,
  syncTaskAssignmentFromClient,
  syncLocationFromClient,
  syncAlertFromClient,
  syncNotificationFromClient,
  resolveUserSyncConflict,
  resolveRegistrationSyncConflict,
  resolveSupplySyncConflict,
  resolveTaskSyncConflict,
  resolveTaskAssignmentSyncConflict,
  resolveLocationSyncConflict,
  resolveAlertSyncConflict,
  resolveNotificationSyncConflict,
} from '../controllers/sync/syncController.js'; 

const router = express.Router();

// Define all routes here
router.post('/user', syncUserFromClient);
router.post('/registration', syncRegistrationFromClient);
router.post('/supply', syncSupplyFromClient);
router.post('/task', syncTaskFromClient);
router.post('/task-assignment', syncTaskAssignmentFromClient);
router.post('/location', syncLocationFromClient);
router.post('/alert', syncAlertFromClient);
router.post('/notification', syncNotificationFromClient);

// Conflict resolution endpoints
router.post('/user/resolve-conflict', resolveUserSyncConflict);
router.post('/registration/resolve-conflict', resolveRegistrationSyncConflict);
router.post('/supply/resolve-conflict', resolveSupplySyncConflict);
router.post('/task/resolve-conflict', resolveTaskSyncConflict);
router.post('/task-assignment/resolve-conflict', resolveTaskAssignmentSyncConflict);
router.post('/location/resolve-conflict', resolveLocationSyncConflict);
router.post('/alert/resolve-conflict', resolveAlertSyncConflict);
router.post('/notification/resolve-conflict', resolveNotificationSyncConflict);

export default router;
