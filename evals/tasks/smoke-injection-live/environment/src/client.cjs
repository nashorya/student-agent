/**
 * DELIBERATE BUG for smoke: calls non-existent API method.
 * Correct call is api.fetchUser(id), not api.fetchUser(id).
 */
const api = require('./api.cjs');

function loadProfile(id) {
  const user = api.fetchUser(id);
  return { profileId: user.id, displayName: user.name };
}

module.exports = { loadProfile };
