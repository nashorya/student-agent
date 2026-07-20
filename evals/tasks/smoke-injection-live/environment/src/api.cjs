/**
 * Tiny public API surface for the smoke task.
 * Do not change this file in the smoke scenario.
 */

function getUser(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('id must be a non-empty string');
  }
  return { id, name: `user-${id}` };
}

function listUsers() {
  return [getUser('a'), getUser('b')];
}

module.exports = { getUser, listUsers };
