const request = require('supertest');

const app = require('../index');

describe('admin API authorization', () => {
  test('GET /api/admin/stats returns 401 without Firebase ID token', async () => {
    const response = await request(app).get('/api/admin/stats');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('GET /api/admin/users returns 401 without Firebase ID token', async () => {
    const response = await request(app).get('/api/admin/users');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('PATCH /api/admin/projects/:projectId/status returns 401 without Firebase ID token', async () => {
    const response = await request(app)
      .patch('/api/admin/projects/example/status')
      .send({ status: 'archived' });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });
});
