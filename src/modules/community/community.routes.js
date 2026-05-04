const express = require('express');
const communityController = require('./community.controller');
const { requireAuth, optionalAuth } = require('../../middleware/auth.middleware');

const communityRouter = express.Router();

communityRouter.get('/feed', optionalAuth, communityController.listFeed);
communityRouter.get('/me/summary', requireAuth, communityController.getMySummary);
communityRouter.get('/me/notifications', requireAuth, communityController.listMyNotifications);
communityRouter.patch('/me/notifications/read', requireAuth, communityController.markNotificationsRead);
communityRouter.get('/users/:userId/summary', optionalAuth, communityController.getUserSummary);
communityRouter.post('/posts', requireAuth, communityController.createPost);
communityRouter.patch('/posts/:id', requireAuth, communityController.updatePost);
communityRouter.delete('/posts/:id', requireAuth, communityController.deletePost);
communityRouter.post('/posts/:id/reactions', requireAuth, communityController.addPostReaction);
communityRouter.delete('/posts/:id/reactions', requireAuth, communityController.removePostReaction);
communityRouter.get('/posts/:id/comments', communityController.listPostComments);
communityRouter.post('/posts/:id/comments', requireAuth, communityController.createPostComment);
communityRouter.post('/follow/:userId', requireAuth, communityController.followUser);
communityRouter.delete('/follow/:userId', requireAuth, communityController.unfollowUser);
communityRouter.get('/users/:userId/followers', communityController.listFollowers);
communityRouter.get('/users/:userId/following', communityController.listFollowing);

communityRouter.get('/lfg-posts', communityController.listLfgPosts);
communityRouter.post('/lfg-posts', requireAuth, communityController.createLfgPost);

module.exports = communityRouter;
