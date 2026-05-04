const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const authRoutes = require('./modules/auth/auth.routes');
const {
  gameTypesRouter,
  gamesRouter
} = require('./modules/games/games.routes');
const {
  gameMembershipsRouter,
  membershipActionsRouter
} = require('./modules/memberships/memberships.routes');
const adminUsersRouter = require('./modules/admin-users/admin-users.routes');
const adminGamesRouter = require('./modules/admin-games/admin-games.routes');
const adminMembershipsRouter = require('./modules/admin-memberships/admin-memberships.routes');
const adminContentRouter = require('./modules/admin-content/admin-content.routes');
const adminMonitoringRouter = require('./modules/admin-monitoring/admin-monitoring.routes');
const communityRouter = require('./modules/community/community.routes');
const profileRouter = require('./modules/profile/profile.routes');
const {
  wikiRouter,
  wikiAdminRouter
} = require('./modules/wiki/wiki.routes');
const protectedRoutes = require('./routes/protected.routes');

const app = express();
const allowedOrigins = Array.from(new Set([
  'http://localhost:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  env.frontendUrl
].filter(Boolean)));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true
}));

app.use(express.json({ limit: '12mb' }));
app.use('/api/auth', authRoutes);
app.use('/api/game-types', gameTypesRouter);
app.use('/api/games', gamesRouter);
app.use('/api/games', gameMembershipsRouter);
app.use('/api/game-memberships', membershipActionsRouter);
app.use('/api/admin', adminUsersRouter);
app.use('/api/admin', adminGamesRouter);
app.use('/api/admin', adminMembershipsRouter);
app.use('/api/admin', adminContentRouter);
app.use('/api/admin', adminMonitoringRouter);
app.use('/api/community', communityRouter);
app.use('/api/profile', profileRouter);
app.use('/api/wiki', wikiRouter);
app.use('/api/admin', wikiAdminRouter);
app.use('/api/protected', protectedRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'dnd-backend',
    env: env.nodeEnv
  });
});

module.exports = app;
