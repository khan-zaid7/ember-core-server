import axios from 'axios';
import { faker } from '@faker-js/faker';

const API_BASE = 'http://localhost:5000/api/sync';

export const syncUser = async () => {
  const data = {
    user_id: 'test_user_' + faker.string.uuid(),
    name: faker.person.fullName(),
    email: faker.internet.email(),
    role: 'volunteer',
    phone_number: faker.phone.number('+1##########'),
    image_url: faker.image.avatar(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const res = await axios.post(`${API_BASE}/user`, data);
  console.log('✅ User sync:', res.data);
};
    