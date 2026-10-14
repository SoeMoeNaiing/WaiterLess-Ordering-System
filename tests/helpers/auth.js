import request from 'supertest';

export async function loginAdmin(app, pin = '1234') {
  const res = await request(app).post('/api/admin/auth/login').send({ pin });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  const cookie = res.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('no admin cookie');
  return cookie;
}

export async function loginKitchen(app, pin = '1234') {
  const res = await request(app).post('/api/kitchen/auth/login').send({ pin });
  if (res.status !== 200) throw new Error(`kitchen login failed: ${res.status}`);
  const cookie = res.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('no kitchen cookie');
  return cookie;
}
