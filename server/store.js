/**
 * 存储适配层
 *
 * 同一套业务代码,跑在两种环境:
 *   - Node.js     : 文件系统(fs)—— 本地 / Render / Docker
 *   - Cloudflare  : KV 绑定     —— Workers/Pages Functions
 *
 * 用法:
 *   const store = createStore(env);
 *   await store.get('users');        → object | null
 *   await store.set('users', obj);   → void
 *   await store.del('users');        → void
 *
 * KV 是最终一致的(全球最多 60 秒传播),
 * 同一个 key 短时间内连续写可能读到旧值 —— 对本工具无影响。
 */

const isWorkers = typeof caches !== 'undefined' && typeof WebSocketPair !== 'undefined';

// ── 文件系统实现(Node) ──
function createFsStore(env) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, 'data', '_db');
  const PROGRESS_DIR = path.join(__dirname, 'data', '_progress');

  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });

  const fileFor = (key) => path.join(ROOT, `${key}.json`);
  const progressFile = (uid) => path.join(PROGRESS_DIR, `${uid}.json`);

  function safeRead(file) {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      console.error('[store] read failed', file, e.message);
      return null;
    }
  }

  function safeWrite(file, obj) {
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[store] write failed', file, e.message);
    }
  }

  return {
    kind: 'fs',

    async get(key) {
      if (key.startsWith('progress:')) {
        return safeRead(progressFile(key.slice(9)));
      }
      return safeRead(fileFor(key));
    },

    async set(key, value) {
      if (key.startsWith('progress:')) {
        safeWrite(progressFile(key.slice(9)), value);
        return;
      }
      safeWrite(fileFor(key), value);
    },

    async del(key) {
      const file = key.startsWith('progress:')
        ? progressFile(key.slice(9))
        : fileFor(key);
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (e) {}
    },

    async list(prefix) {
      // 文件系统:扫目录
      const out = [];
      try {
        const dir = prefix && prefix.startsWith('progress:') ? PROGRESS_DIR : ROOT;
        const want = prefix && prefix.startsWith('progress:') ? prefix.slice(9) : (prefix || '');
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith('.json')) continue;
          const key = prefix && prefix.startsWith('progress:')
            ? 'progress:' + f.slice(0, -5)
            : f.slice(0, -5);
          if (!want || key.startsWith(want)) out.push(key);
        }
      } catch (e) {}
      return out;
    },
  };
}

// ── KV 实现(Cloudflare Workers) ──
function createKvStore(env) {
  const kv = env.KV || env.C3_KV;
  if (!kv) throw new Error('缺少 KV 绑定 (env.KV)');

  return {
    kind: 'kv',

    async get(key) {
      const raw = await kv.get(key, 'json');
      return raw === null || raw === undefined ? null : raw;
    },

    async set(key, value) {
      await kv.put(key, JSON.stringify(value));
    },

    async del(key) {
      await kv.delete(key);
    },

    async list(prefix) {
      const out = [];
      let cursor;
      do {
        const res = await kv.list({ prefix: prefix || '', cursor });
        for (const k of res.keys) out.push(k.name);
        cursor = res.list_complete ? undefined : res.cursor;
      } while (cursor);
      return out;
    },
  };
}

/**
 * 选一个 store
 * @param {object} env - Workers 的 env(bindings)。Node 下传 null
 */
function createStore(env) {
  if (env && (env.KV || env.C3_KV)) {
    try {
      return createKvStore(env);
    } catch (e) {
      console.error('[store] KV 不可用:', e.message);
    }
  }
  return createFsStore(env);
}

module.exports = { createStore, createFsStore, createKvStore, isWorkers };
