import { randomBytes } from 'node:crypto';
import { createAdminPasswordHash } from './adminAuth.js';

const password = randomBytes(18).toString('base64url');
const passwordHash = await createAdminPasswordHash(password);
const sessionSecret = randomBytes(32).toString('hex');

console.log('后台登录密码（只显示一次，请保存到密码管理器，不要截图）：');
console.log(password);
console.log('\n复制到服务器私有 .env.server 的两行配置：');
console.log(`ADMIN_PASSWORD_HASH=${passwordHash}`);
console.log(`ADMIN_SESSION_SECRET=${sessionSecret}`);
