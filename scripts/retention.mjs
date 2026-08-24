#!/usr/bin/env node
/* scripts/retention.mjs — 保持期間の掃除だけを単独で走らせる（ORDER §8）
 *
 *   node scripts/retention.mjs
 *
 * APIキーは要らない。CI では収集の成否に関わらず毎回これを走らせる。
 * キーが外れたまま放置されても「30日以内にリフレッシュまたは削除」を守り続けるため。
 * 中身は scripts/lib/retention.mjs（収集本体からも同じ関数を呼んでいる）。
 */

import { log } from './lib/util.mjs';
import { runRetention } from './lib/retention.mjs';

const res = await runRetention({ now: new Date() });
const total = res.snapshots.length + res.prev.length + res.datasets.length + res.shorts;
if (!total) log.done('retention: nothing to remove');
else {
  if (res.datasets.length) log.warn(`removed ${res.datasets.length} dataset(s) older than the retention limit: ${res.datasets.join(', ')}`);
  log.done('retention: done');
}
