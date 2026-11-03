// 存储适配层测试 —— 验证 fs 和 KV 两种实现行为一致
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { createStore } = require('../server/store.js');

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const bad = (m, e) => { console.log('  ❌', m, e ? '— ' + e : ''); fail++; };

async function testStore(store, label) {
  console.log(`\n=== ${label} ===`);

  // 基础 set/get
  await store.set('t_users', { a: 1, b: 'x' });
  let v = await store.get('t_users');
  assert.deepStrictEqual(v, { a: 1, b: 'x' });
  ok('set/get 往返');

  // 不存在的 key
  v = await store.get('t_nonexistent_key_xyz');
  assert.strictEqual(v, null);
  ok('不存在的 key 返回 null');

  // 覆盖写
  await store.set('t_users', { a: 2 });
  v = await store.get('t_users');
  assert.deepStrictEqual(v, { a: 2 });
  ok('覆盖写');

  // 删除
  await store.set('t_tmp', { x: 1 });
  await store.del('t_tmp');
  v = await store.get('t_tmp');
  assert.strictEqual(v, null);
  ok('删除');

  // 进度 key(独立命名空间)
  await store.set('progress:testuser1', { wrong: { q1: 2 }, fav: {}, stats: { answered: 10 } });
  v = await store.get('progress:testuser1');
  assert.strictEqual(v.stats.answered, 10);
  assert.strictEqual(v.wrong.q1, 2);
  ok('progress: 前缀读写');

  // 进度与普通 key 不冲突
  v = await store.get('t_users');
  assert.deepStrictEqual(v, { a: 2 });
  ok('progress 与普通 key 隔离');

  // 进度删除
  await store.del('progress:testuser1');
  v = await store.get('progress:testuser1');
  assert.strictEqual(v, null);
  ok('progress 删除');

  // list
  await store.set('t_listA', { n: 1 });
  await store.set('t_listB', { n: 2 });
  const keys = await store.list('t_');
  assert.ok(keys.includes('t_listA'), 'list 应含 t_listA');
  assert.ok(keys.includes('t_listB'), 'list 应含 t_listB');
  ok('list 前缀过滤 (' + keys.length + ' 个)');

  // list progress
  await store.set('progress:ua', { n: 1 });
  await store.set('progress:ub', { n: 2 });
  const pkeys = await store.list('progress:');
  assert.ok(pkeys.length >= 2, 'progress list 应有 >=2');
  ok('list progress: (' + pkeys.length + ' 个)');
}

(async () => {
  // fs 实现
  await testStore(createStore(null), '文件系统实现 (Node)');

  // KV 实现 —— 用内存 mock
  console.log('\n=== KV 实现 (内存 mock) ===');
  const mem = new Map();
  const kvMock = {
    async get(key, type) {
      const raw = mem.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, val) { mem.set(key, val); },
    async delete(key) { mem.delete(key); },
    async list({ prefix = '' } = {}) {
      return {
        keys: [...mem.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })),
        list_complete: true,
      };
    },
  };
  const kvStore = createStore({ KV: kvMock });
  assert.strictEqual(kvStore.kind, 'kv');
  ok('识别到 KV 绑定');
  await testStore(kvStore, 'KV 实现 (Workers)');

  // 清理 fs 测试残留
  const dbDir = path.join(__dirname, '..', 'server', 'data', '_db');
  const progDir = path.join(__dirname, '..', 'server', 'data', '_progress');
  for (const d of [dbDir, progDir]) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith('t_') || f.startsWith('test')) {
          fs.unlinkSync(path.join(d, f));
        }
      }
    } catch (e) {}
  }

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  (${pass} 项)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL', e);
  process.exit(1);
});
