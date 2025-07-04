import axios from 'axios';
import { faker } from '@faker-js/faker';

const API_BASE = 'http://localhost:5000/api/sync';

export const syncTask = async () => {
  const data = {
    task_id: 'task_' + faker.string.uuid(),
    title: faker.hacker.phrase(),
    description: faker.lorem.sentence(),
    status: faker.helpers.arrayElement(['pending', 'in-progress', 'completed']),
    priority: faker.helpers.arrayElement(['low', 'normal', 'high']),
    created_by: 'test_user_001',
    due_date: faker.date.future().toISOString(),
    created_at: new Date().toISOString(),
  };

  const res = await axios.post(`${API_BASE}/task`, data);
  console.log('✅ Task sync:', res.data);
};