#!/usr/bin/env node
// Validates enhanced summary fields after aggregation route changes.
import assert from 'assert';
import http from 'http';
import { startServer } from '../server.js';

(async () => {
  const { server, port } = await startServer({ preferredPort: 5400 });
  const candidatePorts = [port, port + 1, port + 2];
  try {
    let summary = null;
    let lastErr = null;
    for (const p of candidatePorts) {
      try {
        summary = await new Promise((resolve, reject) => {
          http.get({ host: 'localhost', port: p, path: '/reports/summary' }, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          }).on('error', reject);
        });
        if (summary) {
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (!summary && lastErr) throw lastErr;
    // Basic shape assertions
    assert.ok(summary.patternUsage, 'patternUsage missing');
    assert.ok(Array.isArray(summary.patternUsage), 'patternUsage not array');
    if (summary.patternUsage.length) {
      const p = summary.patternUsage[0];
      ['patternId', 'count', 'totalComputed', 'weightedComputed', 'pctWithin1pct', 'pctWithin5pct'].forEach((k) =>
        assert.ok(k in p, `missing field on patternUsage: ${k}`)
      );
    }
    assert.ok('totalComputedWeighted' in summary, 'totalComputedWeighted missing');
    console.log('[PASS] enhanced summary structure valid');
    process.exit(0);
  } catch (e) {
    console.error('[FAIL]', e.message);
    process.exit(1);
  } finally {
    if (server && server.listening) {
      try {
        server.close();
      } catch {}
    }
  }
})();
