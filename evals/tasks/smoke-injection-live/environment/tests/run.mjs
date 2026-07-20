import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadProfile } = require('../src/client.cjs');

const profile = loadProfile('42');
if (profile.profileId !== '42' || profile.displayName !== 'user-42') {
  console.error('unexpected profile', profile);
  process.exit(1);
}
console.log('ok', profile);
