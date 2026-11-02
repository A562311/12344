/**
 * Cloudflare Workers 入口
 *
 * 部署:
 *   1. wrangler kv namespace create C3_KV
 *   2. 把返回的 id 填进 wrangler.toml
 *   3. wrangler deploy
 *
 * 或者用 Workers 的 Dashboard 直接粘贴本文件 + 绑定 KV。
 *
 * 运行时:Node.js 兼容模式(compatibility_date = 2024-09-23)
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Node 内置模块在 Workers 里可用(compat flags 开了 nodejs_compat)
const { createStore } = require('./store.js');

// ── 题库加载(打包进 Worker,静态资源) ──
let BANKS = null;
let QUESTIONS = null;

async function loadBanks(env) {
  if (BANKS) return BANKS;
  const raw = await env.ASSETS.fetch(new URL('/sets_c3_2025.json', 'https://x.local/'));
  BANKS = await raw.json();
  return BANKS;
}

async function loadQuestions(env, bank) {
  if (!QUESTIONS) QUESTIONS = new Map();
  if (QUESTIONS.has(bank)) return QUESTIONS.get(bank);
  try {
    const raw = await env.ASSETS.fetch(new URL(`/data/questions_${bank}.json`, 'https://x.local/'));
    const j = await raw.json();
    QUESTIONS.set(bank, j);
    return j;
  } catch (e) {
    return null;
  }
}

// ── 极简路由(与 server.js 行为一致) ──
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      ...headers,
    },
  });
}

function getToken(req, url) {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token') || req.headers.get('x-token') || '';
}

async function handle(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return json({}, 204);

  if (p === '/api/health') {
    return json({ ok: true, ts: Date.now(), platform: 'workers' });
  }

  if (p === '/api/sets') {
    const banks = await loadBanks(env);
    return json(banks);
  }

  if (p.startsWith('/api/questions/')) {
    const bank = p.slice('/api/questions/'.length).split('/')[0];
    const qs = await loadQuestions(env, bank);
    if (!qs) return json({ error: '题库不存在' }, 404);
    const arr = Array.isArray(qs) ? qs : (qs.questions || []);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const size = Math.min(parseInt(url.searchParams.get('size') || '20', 10), 200);
    const slice = arr.slice((page - 1) * size, page * size);
    return json({
      bank, page, size, total: arr.length,
      items: slice.map((q) => ({
        q: q.question, o: q.options, a: q.answer, c: q.category || '',
        av: q.analysis_v2 ? {
          p: q.analysis_v2.core_point || '',
          d: q.analysis_v2.detailed_explanation || q.analysis_v2.core_point || '',
        } : (q.analysis ? { p: q.analysis, d: q.analysis } : null),
      })),
    });
  }

  // 静态资源(前端)
  if (env.ASSETS) return env.ASSETS.fetch(req);

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      console.error('worker error', e);
      return json({ error: e.message }, 500);
    }
  },
};
