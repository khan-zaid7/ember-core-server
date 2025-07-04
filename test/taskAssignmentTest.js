import axios from 'axios';
import { faker } from '@faker-js/faker';

const API_BASE = 'http://localhost:5000/api/sync';

export const syncTaskAssignment = async () => {
  const data = {
    assignment_id: 'assign_' + faker.string.uuid(),
    task_id: 'task_001',
    user_id: 'test_user_001',
    assigned_at: new Date().toISOString(),
    status: faker.helpers.arrayElement(['assigned', 'accepted', 'declined']),
    feedback: faker.lorem.sentence(),
  };

  const res = await axios.post(`${API_BASE}/task-assignment`, data);
  console.log('✅ Task assignment sync:', res.data);
};