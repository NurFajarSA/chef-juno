const { fetchUser } = require('../api/user');

function slugify(text) {
  return text.toLowerCase().replace(/\s+/g, '-');
}

async function userSlug(id) {
  const u = await fetchUser(id);
  return u ? slugify(u.name) : '';
}

module.exports = { slugify, userSlug };
