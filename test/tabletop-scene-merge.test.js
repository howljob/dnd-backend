// Слияние правок сцены стола: сдвиг одного токена не стирает остальные,
// добавление и удаление — явной заменой списка.
// Запуск: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeScenePatch, filterPublishedStateForPlayer, sanitizeToken, readImageSize, sanitizeDrawing, applyDrawingOps } = require('../src/modules/tabletop/tabletop.service');

test('рисунки: кисть/круг/прямоугольник приводятся к безопасным, мусор отбрасывается', () => {
  const path = sanitizeDrawing({ kind: 'path', points: [{ x: 1.4, y: 2 }, { x: 10, y: 'x' }, { x: 20, y: 30 }], stroke: '#ABC', fill: '#ff0000', width: 99 }, 'u1');
  assert.equal(path.kind, 'path');
  assert.deepEqual(path.points, [{ x: 1, y: 2 }, { x: 20, y: 30 }]);
  assert.equal(path.stroke, '#abc');
  assert.equal(path.fill, 'none');
  assert.equal(path.width, 20);
  assert.equal(path.userId, 'u1');
  const circle = sanitizeDrawing({ kind: 'circle', x: 5, y: 6, r: 1, stroke: 'red', fill: '#00ff0080' }, 'u1');
  assert.equal(circle.r, 2);
  assert.equal(circle.stroke, '#ffffff');
  assert.equal(circle.fill, '#00ff0080');
  const rect = sanitizeDrawing({ kind: 'rect', x: 0, y: 0, w: 50, h: 40, fill: 'none' }, 'u1');
  assert.equal(rect.w, 50);
  assert.equal(rect.fill, 'none');
  assert.equal(sanitizeDrawing({ kind: 'text', x: 0, y: 0 }, 'u1'), null);
  assert.equal(sanitizeDrawing({ kind: 'path', points: [{ x: 1, y: 1 }] }, 'u1'), null);
  assert.equal(sanitizeDrawing({ kind: 'circle', x: 'a', y: 0, r: 5 }, 'u1'), null);
});

test('рисунки: игрок стирает только свои, мастер — любые; лимит списка', () => {
  const mine = { id: 'm1', kind: 'circle', x: 1, y: 1, r: 5, userId: 'u1' };
  const other = { id: 'o1', kind: 'circle', x: 1, y: 1, r: 5, userId: 'u2' };
  const list = [mine, other];
  const afterPlayerRemove = applyDrawingOps(list, { remove: ['m1', 'o1'] }, { userId: 'u1', isGm: false });
  assert.deepEqual(afterPlayerRemove.map((d) => d.id), ['o1']);
  const afterPlayerClear = applyDrawingOps(list, { clear: true }, { userId: 'u1', isGm: false });
  assert.deepEqual(afterPlayerClear.map((d) => d.id), ['o1']);
  const afterGmClear = applyDrawingOps(list, { clear: true }, { userId: 'gm', isGm: true });
  assert.deepEqual(afterGmClear, []);
  const afterGmRemove = applyDrawingOps(list, { remove: ['o1'] }, { userId: 'gm', isGm: true });
  assert.deepEqual(afterGmRemove.map((d) => d.id), ['m1']);
  const added = applyDrawingOps(list, { add: [{ id: 'n1', kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { id: 'o1', kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { kind: 'bogus' }] }, { userId: 'u1', isGm: false });
  assert.deepEqual(added.map((d) => d.id), ['m1', 'o1', 'n1']);
  assert.equal(added[2].userId, 'u1');
  // Сдвиг и размер: игрок — только свои, геометрия проверяется, автор и цвет не меняются.
  const styled = [{ ...mine, stroke: '#ff0000', width: 5, at: 123 }, { ...other, points: undefined }];
  const moved = applyDrawingOps(styled, { update: [{ id: 'm1', x: 40, y: 50, r: 9, stroke: '#000000', userId: 'hacker' }, { id: 'o1', x: 99, y: 99 }] }, { userId: 'u1', isGm: false });
  assert.deepEqual({ x: moved[0].x, y: moved[0].y, r: moved[0].r, stroke: moved[0].stroke, width: moved[0].width, userId: moved[0].userId, at: moved[0].at }, { x: 40, y: 50, r: 9, stroke: '#ff0000', width: 5, userId: 'u1', at: 123 });
  assert.equal(moved[1].x, 1, 'игрок сдвинул чужой рисунок');
  const gmMoved = applyDrawingOps(styled, { update: [{ id: 'o1', x: 99, y: 99, r: 1 }] }, { userId: 'gm', isGm: true });
  assert.deepEqual({ x: gmMoved[1].x, r: gmMoved[1].r }, { x: 99, r: 2 });
  const pathList = [{ id: 'p1', kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], userId: 'u1' }];
  const badPath = applyDrawingOps(pathList, { update: [{ id: 'p1', points: [{ x: 1, y: 1 }] }] }, { userId: 'u1', isGm: false });
  assert.equal(badPath[0].points.length, 2, 'ломаная из одной точки должна отклоняться');
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `d${i}`, kind: 'circle', x: 0, y: 0, r: 5, userId: 'u1' }));
  const overflow = applyDrawingOps(many, { add: [{ id: 'last', kind: 'circle', x: 0, y: 0, r: 5 }] }, { userId: 'u1', isGm: false });
  assert.equal(overflow.length, 300);
  assert.equal(overflow[0].id, 'd1');
  assert.equal(overflow[299].id, 'last');
});

test('размер картинки читается из заголовка PNG', () => {
  const png = Buffer.alloc(33, 0);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1920, 16);
  png.writeUInt32BE(1080, 20);
  assert.deepEqual(readImageSize(png, 'image/png'), { width: 1920, height: 1080 });
  assert.deepEqual(readImageSize(Buffer.alloc(4), 'image/jpeg'), { width: null, height: null });
});

const base = () => ({
  tokens: [
    { id: 'a', x: 10, y: 10, size: 48, label: 'Герой', hpCurrent: 12, hpMax: 12 },
    { id: 'b', x: 50, y: 50, size: 44, label: 'Гоблин', hpCurrent: 7, hpMax: 7 },
    { id: 'c', x: 90, y: 90, size: 44, label: 'Волк' }
  ],
  grid: { enabled: false, cellPx: 70, offsetX: 0, offsetY: 0 }
});

test('сцена: сдвиг одного токена сохраняет остальные и его метки', () => {
  const next = mergeScenePatch(base(), { tokens: [{ id: 'b', x: 200, y: 210, size: 44 }] });
  assert.equal(next.tokens.length, 3);
  const b = next.tokens.find((t) => t.id === 'b');
  assert.equal(b.x, 200);
  assert.equal(b.label, 'Гоблин');
  assert.equal(b.hpCurrent, 7);
  assert.ok(next.tokens.some((t) => t.id === 'a') && next.tokens.some((t) => t.id === 'c'));
});

test('сцена: новый токен в списке — список принимается целиком', () => {
  const tokens = [...base().tokens, { id: 'd', x: 1, y: 1, size: 40, label: 'Орк' }];
  const next = mergeScenePatch(base(), { tokens });
  assert.equal(next.tokens.length, 4);
});

test('сцена: удаление — только с tokensMode: replace', () => {
  const without = base().tokens.filter((t) => t.id !== 'c');
  const merged = mergeScenePatch(base(), { tokens: without });
  assert.equal(merged.tokens.length, 3, 'без явного режима токен не удаляется');
  const replaced = mergeScenePatch(base(), { tokens: without, tokensMode: 'replace' });
  assert.equal(replaced.tokens.length, 2);
  assert.ok(!('tokensMode' in replaced));
});

test('сцена для игрока: хиты только своих токенов, заметки мастера скрыты', () => {
  const state = {
    tokens: [
      { id: 'a', x: 1, y: 1, size: 40, label: 'Мой', ownerUserId: 'u1', hpCurrent: 5, hpMax: 10, tempHp: 2, gmNote: 'секрет', conditions: [{ id: 'c1', slug: 'poisoned', icon: '🤢', label: 'Отравлен' }] },
      { id: 'b', x: 2, y: 2, size: 40, label: 'Чужой', ownerUserId: 'u2', hpCurrent: 3, hpMax: 9, gmNote: 'тоже секрет' }
    ]
  };
  const view = filterPublishedStateForPlayer(state, 'u1');
  const mine = view.tokens.find((t) => t.id === 'a');
  const theirs = view.tokens.find((t) => t.id === 'b');
  assert.equal(mine.hpCurrent, 5);
  assert.equal(mine.conditions[0].label, 'Отравлен');
  assert.ok(!('gmNote' in mine));
  assert.ok(!('hpCurrent' in theirs) && !('hpMax' in theirs) && !('tempHp' in theirs));
  assert.ok(!('gmNote' in theirs));
});

test('токен: значения приводятся к безопасным', () => {
  const t = sanitizeToken({
    id: 'a', hpCurrent: '93', hpMax: 'abc', tempHp: -4, gmNote: 'x'.repeat(5000),
    conditions: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, icon: '🔥🔥🔥🔥🔥🔥', label: 'y'.repeat(100) }))
  });
  assert.equal(t.hpCurrent, 93);
  assert.equal(t.hpMax, null);
  assert.equal(t.tempHp, 0);
  assert.equal(t.gmNote.length, 2000);
  assert.equal(t.conditions.length, 12);
  assert.ok(t.conditions[0].label.length <= 40 && t.conditions[0].icon.length <= 8);
});

test('токен: картинка — из библиотеки или портрет персонажа, размер в пределах, закрепление — булево', () => {
  const lib = sanitizeToken({ id: 'a', imageUrl: '/uploads/vtt/0123456789abcdef0123456789abcdef.png' });
  assert.equal(lib.imageUrl, '/uploads/vtt/0123456789abcdef0123456789abcdef.png');
  const portrait = sanitizeToken({ id: 'a', imageUrl: '/uploads/portraits/abc-123_x.jpg' });
  assert.equal(portrait.imageUrl, '/uploads/portraits/abc-123_x.jpg');
  const bad = sanitizeToken({ id: 'a', imageUrl: 'https://evil.example/x.png' });
  assert.equal(bad.imageUrl, null);
  const traversal = sanitizeToken({ id: 'a', imageUrl: '/uploads/portraits/../../.env' });
  assert.equal(traversal.imageUrl, null);
  assert.equal(sanitizeToken({ id: 'a', size: 5 }).size, 16);
  assert.equal(sanitizeToken({ id: 'a', size: 99999 }).size, 1600);
  assert.equal(sanitizeToken({ id: 'a', size: 'abc' }).size, 48);
  assert.equal(sanitizeToken({ id: 'a', size: 140.4 }).size, 140);
  assert.equal(sanitizeToken({ id: 'a', locked: 'yes' }).locked, true);
  assert.equal(sanitizeToken({ id: 'a', locked: 0 }).locked, false);
});

test('токен: поворот — целые градусы 0–359 по кругу, показ имени — булево', () => {
  assert.equal(sanitizeToken({ id: 'a', rotation: 90.4 }).rotation, 90);
  assert.equal(sanitizeToken({ id: 'a', rotation: 360 }).rotation, 0);
  assert.equal(sanitizeToken({ id: 'a', rotation: 725 }).rotation, 5);
  assert.equal(sanitizeToken({ id: 'a', rotation: -90 }).rotation, 270);
  assert.equal(sanitizeToken({ id: 'a', rotation: 'abc' }).rotation, 0);
  assert.ok(!('rotation' in sanitizeToken({ id: 'a' })));
  assert.equal(sanitizeToken({ id: 'a', showName: true }).showName, true);
  assert.equal(sanitizeToken({ id: 'a', showName: 'yes' }).showName, false);
  assert.equal(sanitizeToken({ id: 'a', showName: 1 }).showName, false);
  assert.ok(!('showName' in sanitizeToken({ id: 'a' })));
});

test('сцена: остальные поля патча сливаются как раньше', () => {
  const next = mergeScenePatch(base(), { tokens: [{ id: 'a', x: 5, y: 5, size: 48 }], grid: { enabled: true } });
  assert.equal(next.grid.enabled, true);
  assert.equal(next.grid.cellPx, 70);
});
