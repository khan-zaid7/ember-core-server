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

export default router;
