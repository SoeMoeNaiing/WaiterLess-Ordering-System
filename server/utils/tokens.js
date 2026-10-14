import { nanoid } from 'nanoid';

// URL-safe, 12 chars. 62^12 ≈ 3.2e21 combinations.
export function newTableToken() {
  return nanoid(12);
}
