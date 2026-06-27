const request = require('supertest');

const app = require('../index');

describe('assistant API validation', () => {
  test('GET /health returns backend health status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  test('POST /api/generate-tasks returns 400 when prompt is missing', async () => {
    const response = await request(app).post('/api/generate-tasks').send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  test('POST /api/summarize-chat returns 400 when messages are missing', async () => {
    const response = await request(app).post('/api/summarize-chat').send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  test('POST /api/assistant/chat returns 400 when userMessage is missing', async () => {
    const response = await request(app).post('/api/assistant/chat').send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  test('POST /api/assistant/action returns 400 when action is invalid', async () => {
    const response = await request(app)
      .post('/api/assistant/action')
      .send({ action: 'DELETE_PROJECT' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
