// 把漏掉的灰阶硬编码换成令牌。这些是令牌化那一轮没覆盖到的（当时只扫了
// 出现次数 ≥4 的色值，而这几个散在少数几处）。
export default [
  { from: '#b6b5ae', to: 'var(--bold-faint)' },
  { from: '#8b8b85', to: 'var(--bold-muted)' },
];
