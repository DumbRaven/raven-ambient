export type AmbientCover = { id: string; name: string; color: string; keywords: string[] };

// Small, offline vocabulary. Specific phrases win; English matches whole words.
export const ambientCovers: AmbientCover[] = [
  { id: 'thunder', name: '雷雨', color: '#7e879a', keywords: ['雷雨', '雷声', '雷暴', 'thunderstorm', 'thunder'] },
  { id: 'rain', name: '雨声', color: '#82979a', keywords: ['雨声', '下雨', '细雨', '大雨', '雨', 'rainfall', 'rain', 'rainy', 'drizzle'] },
  { id: 'ocean', name: '海浪', color: '#78969b', keywords: ['海浪', '海边', '海潮', '海洋', '潮汐', 'ocean', 'sea', 'waves', 'surf', 'beach'] },
  { id: 'stream', name: '溪流', color: '#829c95', keywords: ['溪流', '流水', '河流', '瀑布', '泉水', 'stream', 'river', 'waterfall', 'brook'] },
  { id: 'forest', name: '森林', color: '#87967c', keywords: ['森林', '松林', '松树', '树林', '竹林', '林间', '树叶', 'forest', 'woods', 'woodland', 'leaves', 'pine'] },
  { id: 'wind', name: '微风', color: '#9b9e84', keywords: ['微风', '风声', '晚风', '清风', '风吹', 'wind', 'windy', 'breeze'] },
  { id: 'birds', name: '鸟鸣', color: '#a2a080', keywords: ['鸟鸣', '鸟叫', '鸟声', 'birdsong', 'birds', 'bird', 'chirping'] },
  { id: 'insects', name: '虫鸣', color: '#939379', keywords: ['虫鸣', '虫叫', '蟋蟀', '蝉鸣', '蛙鸣', 'crickets', 'cricket', 'cicada', 'insects', 'frogs'] },
  { id: 'fire', name: '炉火', color: '#b38d77', keywords: ['壁炉', '炉火', '篝火', '柴火', '火焰', 'fireplace', 'campfire', 'fire', 'crackling'] },
  { id: 'cafe', name: '咖啡馆', color: '#a28e80', keywords: ['咖啡馆', '咖啡厅', '咖啡', '餐厅', 'cafe', 'café', 'coffee', 'restaurant'] },
  { id: 'train', name: '列车', color: '#8b9298', keywords: ['火车', '列车', '铁轨', '地铁', 'train', 'railway', 'subway'] },
  { id: 'city', name: '城市', color: '#99918c', keywords: ['城市', '街道', '街头', '车流', '交通', 'city', 'street', 'traffic', 'urban'] },
  { id: 'keyboard', name: '打字', color: '#94909e', keywords: ['键盘', '打字', '机械键盘', 'keyboard', 'typing', 'typewriter'] },
  { id: 'writing', name: '书写', color: '#a49481', keywords: ['书写', '写字', '钢笔', '铅笔', '翻书', '翻页', 'writing', 'pencil', 'paper', 'page turning'] },
  { id: 'fan', name: '风扇', color: '#8c9a99', keywords: ['风扇', '电扇', '空调', '通风', 'fan', 'ventilation', 'air conditioner'] },
  { id: 'snow', name: '落雪', color: '#98a2b0', keywords: ['下雪', '落雪', '风雪', '暴雪', 'snow', 'snowfall', 'blizzard'] },
  { id: 'noise', name: '白噪音', color: '#a19aab', keywords: ['白噪音', '白噪声', '粉噪', '棕噪', 'white noise', 'pink noise', 'brown noise', 'static'] },
];

export const findAmbientCover = (id?: string) => ambientCovers.find(cover => cover.id === id);
export const ambientCoverUrl = (id?: string) => findAmbientCover(id) ? `./covers/${id}.svg` : undefined;
export function matchAmbientCover(name: string): AmbientCover | undefined {
  const text = name.normalize('NFKC').toLowerCase().replace(/[_\-]+/g, ' ');
  let best: AmbientCover | undefined, bestScore = 0;
  for (const cover of ambientCovers) {
    for (const keyword of cover.keywords) {
      const matches = /[\u3400-\u9fff]/u.test(keyword)
        ? text.includes(keyword)
        : new RegExp(`(?:^|[^a-z])${keyword}(?=$|[^a-z])`, 'u').test(text);
      const score = keyword.length;
      if (matches && score > bestScore) { best = cover; bestScore = score; }
    }
  }
  return best;
}
