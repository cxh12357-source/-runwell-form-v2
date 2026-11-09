import { escape as esc } from '../../lib/api.js';

const dayMs = 86400000;
const dayNumber = date => Math.floor(Date.parse(date + 'T00:00:00Z') / dayMs);
const isoDay = day => new Date(day * dayMs).toISOString().slice(0, 10);

export function dashboardTrend(board, employee) {
  const daily = new Map();
  for (const record of board.records) {
    if (employee && record.created_by !== employee) continue;
    const day = Math.floor((Date.parse(record.created_at) + 8 * 3600000) / dayMs);
    if (Number.isFinite(day)) daily.set(day, (daily.get(day) || 0) + 1);
  }
  const days = [...daily.keys()].sort((a, b) => a - b);
  const first = board.range.from ? dayNumber(board.range.from) : days[0];
  const last = board.range.to ? dayNumber(board.range.to) : days.at(-1);
  const title = '<h3 id="dashboard-trend-title">表单生成趋势' + (employee ? ' · ' + esc(employee) : '') + '</h3>';
  if (first === undefined) return title + '<p class="hint">暂无生成记录。</p>';

  const span = last - first;
  const x = day => span ? 62 + (day - first) / span * 652 : 388;
  const peak = days.reduce((max, day) => Math.max(max, daily.get(day)), 1);
  const step = Math.max(1, Math.ceil(peak / 4));
  const top = Math.ceil(peak / step) * step;
  const y = count => 208 - count / top * 160;
  const ticks = Array.from({length: Math.min(6, span + 1)}, (_, i) => first + Math.round(i * span / Math.max(1, Math.min(5, span))));
  // Keep the zero baseline across long gaps without drawing thousands of identical points.
  const points = [...new Set([first, last, ...days.flatMap(day => [day - 1, day, day + 1])])]
    .filter(day => day >= first && day <= last).sort((a, b) => a - b);
  const countTicks = Array.from({length: top / step + 1}, (_, i) => i * step);
  return title + '<p class="hint">按上海时间统计 · 未生成的日期计为 0</p>' +
    '<div class="dashboard-trend-scroll"><svg class="dashboard-trend-svg" viewBox="0 0 780 260" role="img" aria-label="按日期显示每日生成表单数，最高 ' +
    (daily.size ? peak : 0) + ' 份"><text x="62" y="24">生成表单数</text>' +
    countTicks.map(count => '<path class="dashboard-trend-grid" d="M62 ' + y(count) + 'H714"/><text x="51" y="' + (y(count) + 4) + '" text-anchor="end">' + count + '</text>').join('') +
    '<path class="dashboard-trend-axis" d="M62 48V208H714"/>' +
    ticks.map(day => '<text x="' + x(day).toFixed(1) + '" y="228" text-anchor="middle">' + isoDay(day).slice(span >= 365 ? 0 : 5) + '</text>').join('') +
    '<text x="754" y="250" text-anchor="end">日期</text><polyline class="dashboard-trend-line" points="' +
    points.map(day => x(day).toFixed(2) + ',' + y(daily.get(day) || 0).toFixed(2)).join(' ') + '"/>' +
    (days.length ? days : span ? [] : [first]).map(day => '<circle class="dashboard-trend-point" cx="' + x(day).toFixed(2) +
    '" cy="' + y(daily.get(day) || 0).toFixed(2) + '" r="4"><title>' + isoDay(day) + '：' + (daily.get(day) || 0) + ' 份</title></circle>').join('') +
    '</svg></div>';
}
