const config = require('../config');
const { resolveSession } = require('./sessions');

function currentUser(req, db) {
  const token = req.cookies?.[config.auth.cookieName];
  return resolveSession(db, token);
}

function requireAuthApi(db) {
  return (req, res, next) => {
    const user = currentUser(req, db);
    if (!user) {
      res.status(401).json({ error: 'Not signed in' });
      return;
    }
    req.user = user;
    next();
  };
}

function requireAuthPage(db) {
  return (req, res, next) => {
    const user = currentUser(req, db);
    if (!user) {
      res.redirect('/login.html');
      return;
    }
    req.user = user;
    next();
  };
}

// Composes on top of requireAuthApi/requireAuthPage — mount after one of
// those so req.user is already set.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

module.exports = { requireAuthApi, requireAuthPage, requireAdmin, currentUser };
