import axios from 'axios';
import { faker } from '@faker-js/faker';

const API_BASE = 'http://localhost:5000/api/sync';

export const syncSupply = async () => {
  const data = {
    supply_id: 'supply_' + faker.string.uuid(),
    user_id: 'test_user_001',
    item_name: faker.commerce.productName(),
    quantity: faker.number.int({ min: 1, max: 100 }),
    expiry_date: faker.date.future().toISOString(),
    location_id: 'loc_001',
    timestamp: new Date().toISOString(),
    status: faker.helpers.arrayElement(['active', 'expired', 'used']),
  };

  const res = await axios.post(`${API_BASE}/supply`, data);
  console.log('✅ Supply sync:', res.data);
};