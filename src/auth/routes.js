const express = require('express');
const config = require('../config');
const logger = require('../logger');
const { hashPassword, verifyPassword, isValidPassword, MIN_PASSWORD_LENGTH } = require('./passwords');
const { issueSession, revokeSession } = require('./sessions');
const { requireAuthApi, requireAdmin } = require('./middleware');

function setCookie(res, token, expiresAt) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearCookie(res) {
  res.clearCookie(config.auth.cookieName, { path: '/' });
}

function createAuthRouter(db) {
  const router = express.Router();
  const requireAuth = requireAuthApi(db);

  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password required' });
      return;
    }
    const user = db.getUser(username);
    if (!user || !verifyPassword(password, { salt: user.salt, hash: user.password_hash })) {
      logger.warn('Rejected login attempt', { username, ip: req.ip });
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }
    const { token, expiresAt } = issueSession(db, user.username);
    setCookie(res, token, expiresAt);
    res.json({ username: user.username, displayName: user.display_name, role: user.role });
  });

  router.post('/logout', (req, res) => {
    revokeSession(db, req.cookies?.[config.auth.cookieName]);
    clearCookie(res);
    res.json({ loggedOut: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  router.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
    res.json({ users: db.listUsers() });
  });

  router.post('/admin/users', requireAuth, requireAdmin, (req, res) => {
    const { username, displayName, password, role } = req.body || {};
    if (!username || !displayName || !password) {
      res.status(400).json({ error: 'username, displayName, and password are required' });
      return;
    }
    if (!isValidPassword(password)) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    if (db.getUser(username)) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    const { hash, salt } = hashPassword(password);
    db.createUser({ username, displayName, passwordHash: hash, salt, role: role === 'admin' ? 'admin' : 'user' });
    res.status(201).json({ username });
  });

  router.delete('/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const target = db.getUser(username);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (username === req.user.username) {
      res.status(400).json({ error: "Can't delete your own account" });
      return;
    }
    if (target.role === 'admin' && db.adminCount() <= 1) {
      res.status(400).json({ error: "Can't delete the last remaining admin" });
      return;
    }
    db.deleteUser(username);
    res.json({ deleted: username });
  });

  router.post('/admin/users/:username/reset-password', requireAuth, requireAdmin, (req, res) => {
    const { username } = req.params;
    const { newPassword } = req.body || {};
    if (!db.getUser(username)) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (!isValidPassword(newPassword)) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    const { hash, salt } = hashPassword(newPassword);
    db.updatePassword(username, { passwordHash: hash, salt }); // also revokes existing sessions
    res.json({ reset: username });
  });

  return router;
}

module.exports = { createAuthRouter };
