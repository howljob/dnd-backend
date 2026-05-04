const communityService = require('./community.service');

function handleError(res, error) {
  if (error.statusCode === 400) {
    return res.status(400).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 401) {
    return res.status(401).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 403) {
    return res.status(403).json({
      ok: false,
      message: error.message
    });
  }

  if (error.statusCode === 404) {
    return res.status(404).json({
      ok: false,
      message: error.message
    });
  }

  console.error(error);

  return res.status(500).json({
    ok: false,
    message: 'Internal server error'
  });
}

async function listFeed(req, res) {
  try {
    const result = await communityService.listFeed(req.auth || null, req.query);
    return res.status(200).json({
      ok: true,
      items: result.items,
      pageInfo: result.pageInfo
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createPost(req, res) {
  try {
    const post = await communityService.createPost(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      post
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getMySummary(req, res) {
  try {
    const summary = await communityService.getMySummary(req.auth);
    return res.status(200).json({
      ok: true,
      summary
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function getUserSummary(req, res) {
  try {
    const summary = await communityService.getUserSummary(req.auth || null, req.params.userId);
    return res.status(200).json({
      ok: true,
      summary
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listMyNotifications(req, res) {
  try {
    const items = await communityService.listMyNotifications(req.auth, req.query);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function markNotificationsRead(req, res) {
  try {
    await communityService.markNotificationsRead(req.auth);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}


async function updatePost(req, res) {
  try {
    const post = await communityService.updatePost(req.auth, req.params.id, req.body);
    return res.status(200).json({
      ok: true,
      post
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function deletePost(req, res) {
  try {
    await communityService.deletePost(req.auth, req.params.id);
    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function addPostReaction(req, res) {
  try {
    const post = await communityService.addPostReaction(req.auth, req.params.id);
    return res.status(200).json({
      ok: true,
      post
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function removePostReaction(req, res) {
  try {
    const post = await communityService.removePostReaction(req.auth, req.params.id);
    return res.status(200).json({
      ok: true,
      post
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listPostComments(req, res) {
  try {
    const items = await communityService.listPostComments(req.params.id);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createPostComment(req, res) {
  try {
    const items = await communityService.createPostComment(req.auth, req.params.id, req.body);
    return res.status(201).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function followUser(req, res) {
  try {
    await communityService.followUser(req.auth, req.params.userId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}

async function unfollowUser(req, res) {
  try {
    await communityService.unfollowUser(req.auth, req.params.userId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listFollowers(req, res) {
  try {
    const items = await communityService.listFollowers(req.params.userId);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listFollowing(req, res) {
  try {
    const items = await communityService.listFollowing(req.params.userId);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function listLfgPosts(req, res) {
  try {
    const items = await communityService.listLfgPosts(req.query);
    return res.status(200).json({
      ok: true,
      items
    });
  } catch (error) {
    return handleError(res, error);
  }
}

async function createLfgPost(req, res) {
  try {
    const post = await communityService.createLfgPost(req.auth, req.body);
    return res.status(201).json({
      ok: true,
      post
    });
  } catch (error) {
    return handleError(res, error);
  }
}

module.exports = {
  listFeed,
  getMySummary,
  getUserSummary,
  listMyNotifications,
  markNotificationsRead,
  createPost,
  updatePost,
  deletePost,
  addPostReaction,
  removePostReaction,
  listPostComments,
  createPostComment,
  followUser,
  unfollowUser,
  listFollowers,
  listFollowing,
  listLfgPosts,
  createLfgPost
};
