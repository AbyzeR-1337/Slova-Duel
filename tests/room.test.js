import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomHost, MAX_PLAYERS } from '../js/room/host.js';
import { until } from './helpers.js';

function setup() {
  const local = [];
  const sent = [];
  const net = { sendTo: (id, m) => sent.push({ id, m }), broadcast: (m) => sent.push({ id: null, m }), forget() {} };
  const room = new RoomHost({ me: { id: 'host', name: 'Аня', avatar: '🦊', color: '#ff0000' }, net, local: (m) => local.push(m), botName: (n) => `Бот ${n}` });
  return { room, local, sent };
}

test('в комнату входят до 10 игроков, одиннадцатому — «мест нет»', () => {
  const { room, sent } = setup();
  for (let i = 1; i < MAX_PLAYERS; i++) room.handle('g' + i, { t: 'hello', p: { name: 'Гость ' + i, avatar: '🐼', color: '#00ff00' } });
  assert.equal(room.players.length, 10);
  assert.ok(sent.some((s) => s.id === 'g3' && s.m.t === 'welcome' && s.m.room.players.length >= 4));
  room.handle('g11', { t: 'hello', p: { name: 'Лишний' } });
  assert.equal(room.players.length, 10);
  assert.ok(sent.some((s) => s.id === 'g11' && s.m.t === 'full'));
  // Повторный вход того же игрока (перезагрузил страницу) — не новый игрок.
  room.handle('g3', { t: 'hello', p: { name: 'Гость 3' } });
  assert.equal(room.players.length, 10);
});

test('только хозяин выбирает игру и настройки; профиль обновляется', () => {
  const { room } = setup();
  room.handle('g1', { t: 'hello', p: { name: 'Боря' } });
  room.handle('g1', { t: 'pick', game: 'poker' });
  assert.equal(room.gameId, 'words');
  room.handle('host', { t: 'pick', game: 'poker' });
  assert.equal(room.gameId, 'poker');
  room.handle('host', { t: 'set', key: 'chips', value: 2000 });
  room.handle('host', { t: 'set', key: 'chips', value: 777 }); // нет такого варианта
  assert.equal(room.settings.poker.chips, 2000);
  room.handle('g1', { t: 'profile', p: { name: 'Борис', avatar: '🐯', color: '#123456', shape: 'star', fx: 'fireworks' } });
  const p = room.player('g1');
  assert.equal(p.name, 'Борис');
  assert.equal(p.shape, 'star');
});

test('боты садятся только в карточные игры; Дурак — максимум 6', async () => {
  const { room } = setup();
  for (let i = 0; i < 7; i++) room.handle('host', { t: 'addBot' });
  assert.equal(room.players.length, 8);
  room.gameId = 'words';
  assert.equal(room.pickSeats().length, 1);
  room.gameId = 'durak';
  assert.equal(room.pickSeats().length, 6);
  assert.equal(room.pickSeats()[0].id, 'host');
  room.handle('host', { t: 'kick', id: 'bot1' });
  assert.equal(room.players.length, 7);
});

test('итог игры попадает в таблицу лидеров комнаты', async () => {
  const { room, local } = setup();
  room.handle('g1', { t: 'hello', p: { name: 'Боря' } });
  room.handle('host', { t: 'pick', game: 'bj' });
  room.handle('host', { t: 'start' });
  await until(() => room.phase === 'game');
  assert.ok(local.some((m) => m.t === 'gstart' && m.seats.length === 2));
  room.endGame({ ranking: [{ id: 'g1', score: 1500 }, { id: 'host', score: 500 }] });
  assert.equal(room.phase, 'lobby');
  const board = room.roomState().board;
  assert.equal(board[0].id, 'g1');
  assert.equal(board[0].points, 10);
  assert.equal(board[0].wins.bj, 1);
  assert.equal(board[1].points, 6);
  assert.ok(local.some((m) => m.t === 'gend' && m.ranking[0].name === 'Боря'));
});
