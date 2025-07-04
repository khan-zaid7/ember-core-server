// testSync.js
import { syncUser } from './userTest.js';
import { syncRegistration } from './registrationTest.js';
import { syncSupply } from './supplyTest.js';
import { syncTask } from './taskTest.js';
import { syncTaskAssignment } from './taskAssignmentTest.js';
import { syncLocation } from './locationTest.js';
import { syncAlert } from './alertTest.js';

const syncAll = async () => {
  await syncUser();
  await syncRegistration();
  await syncSupply();
  await syncTask();
  await syncTaskAssignment();
  await syncLocation();
  await syncAlert();
};

syncAll();
