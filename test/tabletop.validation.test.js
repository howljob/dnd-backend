const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/db/pool');
const {
  createDefaultState,
  applyScenePatch,
  normalizeBaseVersion,
  normalizePatchTarget,
  redactStateForPlayer
} = require('../src/modules/tabletop/tabletop.validation');
const tabletopService = require('../src/modules/tabletop/tabletop.service');
const { getTabletopMembership } = require('../src/modules/tabletop/tabletop.permissions');

const GAME_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SCENE_ID = '33333333-3333-4333-8333-333333333333';

test('tokens.add normalizes plain text and clamps numeric values', () => {
  const nextState = applyScenePatch(createDefaultState(), {
    type: 'tokens.add',
    token: {
      label: '  Goblin  ',
      x: 320.2,
      y: -240.7,
      size: 5000,
      kind: 'monster',
      hpCurrent: -5,
      hpMax: 7
    }
  }, {
    generateId: () => 'token-1'
  });

  assert.deepEqual(nextState.tokens[0], {
    id: 'token-1',
    label: 'Goblin',
    x: 320,
    y: -241,
    size: 1000,
    kind: 'monster',
    hpCurrent: 0,
    hpMax: 7
  });
});

test('tokens.update rejects forbidden or unknown token fields', () => {
  const state = applyScenePatch(createDefaultState(), {
    type: 'tokens.add',
    token: {
      label: 'Goblin',
      x: 0,
      y: 0
    }
  }, {
    generateId: () => 'token-1'
  });

  assert.throws(() => applyScenePatch(state, {
    type: 'tokens.update',
    tokenId: 'token-1',
    changes: {
      hidden: true
    }
  }), /Unknown field/);
});

test('state.merge validates allowlist and rejects gm-only fields', () => {
  assert.throws(() => applyScenePatch(createDefaultState(), {
    type: 'state.merge',
    changes: {
      gmNotes: ['secret']
    }
  }), /Forbidden field/);

  assert.throws(() => applyScenePatch(createDefaultState(), {
    type: 'state.merge',
    changes: {
      grid: {
        enabled: true,
        color: 'red'
      }
    }
  }), /Unknown field/);
});

test('target published is rejected for M1 scene patch', () => {
  assert.equal(normalizePatchTarget('draft'), 'draft');
  assert.throws(() => normalizePatchTarget('published'), /Invalid patch target/);
});

test('redactStateForPlayer removes GM-only token data and hidden tokens', () => {
  const state = {
    ...createDefaultState(),
    gmNotes: ['secret'],
    tokens: [
      {
        id: 'visible',
        label: 'Visible',
        x: 1,
        y: 2,
        size: 44,
        kind: 'monster',
        gmNotes: ['secret']
      },
      {
        id: 'hidden',
        label: 'Hidden',
        x: 1,
        y: 2,
        size: 44,
        kind: 'monster',
        hidden: true
      },
      {
        id: 'gm-only',
        label: 'GM only',
        x: 1,
        y: 2,
        size: 44,
        kind: 'monster',
        visibility: 'gm'
      }
    ]
  };

  const redacted = redactStateForPlayer(state);

  assert.equal(redacted.gmNotes, undefined);
  assert.equal(redacted.tokens.length, 1);
  assert.equal(redacted.tokens[0].id, 'visible');
  assert.equal(redacted.tokens[0].gmNotes, undefined);
  assert.equal(redacted.tokens[0].hidden, undefined);
  assert.equal(redacted.tokens[0].visibility, undefined);
});

test('player bundle contains active published scenes without draftState', () => {
  const scene = {
    id: 'scene-1',
    name: 'Scene',
    isActive: true,
    version: 1,
    draftState: {
      ...createDefaultState(),
      gmNotes: ['draft secret']
    },
    publishedState: {
      ...createDefaultState(),
      gmNotes: ['published secret']
    }
  };

  const bundle = tabletopService.buildBundle(GAME_ID, { role: 'player', isGm: false }, [scene]);

  assert.equal(bundle.isGm, false);
  assert.equal(bundle.scenes.length, 1);
  assert.equal(bundle.scenes[0].draftState, undefined);
  assert.equal(bundle.scenes[0].publishedState.gmNotes, undefined);
});

test('player bundle returns safe empty scenes without creating a default scene', () => {
  const bundle = tabletopService.buildBundle(GAME_ID, { role: 'player', isGm: false }, []);

  assert.deepEqual(bundle, {
    gameId: GAME_ID,
    isGm: false,
    role: 'player',
    scenes: []
  });
});

test('baseVersion must be a positive integer', () => {
  assert.equal(normalizeBaseVersion(3), 3);
  assert.throws(() => normalizeBaseVersion(undefined), /baseVersion is required/);
  assert.throws(() => normalizeBaseVersion(0), /baseVersion is required/);
});

test('tabletop membership requires approved member and exposes isGm from membership role', async () => {
  const gmDb = {
    query: async () => ({
      rows: [{
        game_id: GAME_ID,
        membership_id: 'membership-1',
        member_role: 'gm',
        status: 'approved'
      }]
    })
  };

  const gmMembership = await getTabletopMembership({ userId: USER_ID }, GAME_ID, gmDb);
  assert.equal(gmMembership.isGm, true);
  assert.equal(gmMembership.role, 'gm');

  const pendingDb = {
    query: async () => ({
      rows: [{
        game_id: GAME_ID,
        membership_id: 'membership-2',
        member_role: 'player',
        status: 'pending'
      }]
    })
  };

  await assert.rejects(
    () => getTabletopMembership({ userId: USER_ID }, GAME_ID, pendingDb),
    /Forbidden/
  );

  const nonMemberDb = {
    query: async () => ({
      rows: [{
        game_id: GAME_ID,
        membership_id: null,
        member_role: null,
        status: null
      }]
    })
  };

  await assert.rejects(
    () => getTabletopMembership({ userId: USER_ID }, GAME_ID, nonMemberDb),
    /Forbidden/
  );
});

test('patchScene rejects stale baseVersion before applying patch', async () => {
  const { calls, restore } = mockPatchSceneClient({
    version: 4
  });

  try {
    await assert.rejects(
      () => tabletopService.patchScene({ userId: USER_ID }, GAME_ID, SCENE_ID, {
        target: 'draft',
        baseVersion: 3,
        patch: {
          type: 'tokens.add',
          token: {
            label: 'Goblin',
            x: 0,
            y: 0
          }
        }
      }),
      /Stale baseVersion/
    );
  } finally {
    restore();
  }

  assert.equal(calls.some((sql) => String(sql).startsWith('UPDATE tabletop_scenes')), false);
  assert.equal(calls.includes('ROLLBACK'), true);
});

test('patchScene rejects target published before applying patch', async () => {
  const { calls, restore } = mockPatchSceneClient({
    version: 3
  });

  try {
    await assert.rejects(
      () => tabletopService.patchScene({ userId: USER_ID }, GAME_ID, SCENE_ID, {
        target: 'published',
        baseVersion: 3,
        patch: {
          type: 'tokens.add',
          token: {
            label: 'Goblin',
            x: 0,
            y: 0
          }
        }
      }),
      /Invalid patch target/
    );
  } finally {
    restore();
  }

  assert.equal(calls.length, 0);
});

function mockPatchSceneClient({ version }) {
  const originalConnect = pool.connect;
  const calls = [];
  const fakeClient = {
    query: async (sql) => {
      calls.push(String(sql));
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      if (String(sql).includes('FROM games g')) {
        return {
          rows: [{
            game_id: GAME_ID,
            membership_id: 'membership-1',
            member_role: 'gm',
            status: 'approved'
          }]
        };
      }
      if (String(sql).includes('FROM tabletop_scenes') && String(sql).includes('FOR UPDATE')) {
        return {
          rows: [{
            id: SCENE_ID,
            game_id: GAME_ID,
            name: 'Scene',
            is_active: true,
            draft_state: createDefaultState(),
            published_state: createDefaultState(),
            version,
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            updated_at: new Date('2026-01-01T00:00:00.000Z')
          }]
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    release: () => {}
  };

  pool.connect = async () => fakeClient;

  return {
    calls,
    restore: () => {
      pool.connect = originalConnect;
    }
  };
}
