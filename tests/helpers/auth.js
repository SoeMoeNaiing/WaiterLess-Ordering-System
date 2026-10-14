import request from 'supertest';

// Logs in with the seeded PIN and returns the Set-Cookie header value,
// which the caller can pass to subsequent requests via `.set('Cookie', cookie)`.
export async function loginAdmin(app, pin = '1234') {
  const res = await request(app).post('/api/admin/auth/login').send({ pin });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  const cookie = res.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('no set-cookie from login');
  return cookie;
}
