import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { loadGoals, iconFile } from '../src/goals.ts';

const root = new URL('../public/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('./goals/index.json', root), 'utf8'));
const requests = [];
globalThis.fetch = async path => {
  requests.push(path);
  return { json: async () => path === '/goals/index.json'
    ? { versions: [...index.versions, '99.0.0'] }
    : JSON.parse(readFileSync(new URL('.' + path, root), 'utf8')) };
};

test('timestamped and dev Bingout builds resolve to their release, even with newer data available', async () => {
  for (const version of ['2.16.0-build.20261113163839736+mc26.3', '2.16.0-build.20261113172305089+mc26.3', '2.16.0-build.dev+mc26.3', '2.16.0+mc26.3']) {
    const result = await loadGoals(version);
    assert.equal(result.version, '2.16.0');
    assert.equal(result.goals['yet-another-minecraft-bingo:draftout/obtain_dragon_egg'].n, 'Obtain Dragon Egg');
  }
  assert.equal(requests.filter(p => p === '/goals/2.16.0/goals.json').length, 1);
});

test('old YAB rounds keep using their original catalog', async () => {
  assert.equal((await loadGoals('2.15.1+mc26.3')).version, '2.15.1');
});

test('every Draftout goal has both names and all rendered icon files', async () => {
  const { goals, version } = await loadGoals('2.16.0');
  const draft = Object.entries(goals).filter(([, goal]) => goal.draft);
  assert.equal(draft.length, 406);
  for (const [id, goal] of draft) {
    assert.ok(goal.n && goal.z, id);
    assert.ok('SABCD'.includes(goal.t), id);
    const keys = goal.img ? ['img:' + goal.img] : goal.s ? goal.ii : [goal.i];
    assert.ok(keys?.length, id);
    for (const key of keys) {
      assert.ok(key && existsSync(new URL(`./goals/${version}/icons/${iconFile(key)}`, root)), `${id}: ${key}`);
    }
  }
});
