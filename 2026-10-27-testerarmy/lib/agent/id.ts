import { randomBytes } from 'node:crypto';
export const nanoid = () => randomBytes(5).toString('hex');
