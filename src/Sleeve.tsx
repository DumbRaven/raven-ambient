import type { CSSProperties } from 'react';
import Vinyl from './VinylDisc';
import type { RecordItem } from './records';
import type { SleeveArt, SleeveMotif } from './sleeves';

/**
 * 无封面唱片的构图元素。
 * 每一款只放真正需要的形状，其余靠 CSS 画。
 */
function SleeveMarks({ motif }: { motif: SleeveMotif }) {
  if (motif === 'orbit') {
    return (
      <>
        <span className="cover-orbit orbit-one" />
        <span className="cover-orbit orbit-two" />
        <span className="cover-orbit orbit-three" />
        <span className="cover-sun" />
      </>
    );
  }
  if (motif === 'dawn') {
    return (
      <>
        <span className="sleeve-glow" />
        <span className="sleeve-disc" />
      </>
    );
  }
  if (motif === 'horizon') {
    return (
      <>
        <span className="sleeve-sky" />
        <span className="sleeve-line" />
        <span className="sleeve-line second" />
      </>
    );
  }
  if (motif === 'arch') return <span className="sleeve-gate" />;
  if (motif === 'ripple') {
    return (
      <>
        <span className="ripple-ring r1" />
        <span className="ripple-ring r2" />
        <span className="ripple-ring r3" />
        <span className="ripple-ring r4" />
      </>
    );
  }
  return (
    <>
      <span className="sleeve-band b1" />
      <span className="sleeve-band b2" />
      <span className="sleeve-band b3" />
    </>
  );
}

/**
 * 唱片盒外观：有自定义封面就照用；没有就用本次启动随机到的封套款式。
 *
 * `preview` 用于空柜子里的示意卡片——那时没有真实唱片，仍要摆出一个盒子。
 */
export default function Sleeve({ record, cover, art, playing, preview = false }: { record?: RecordItem; cover?: string; art?: SleeveArt; playing: boolean; preview?: boolean }) {
  const motif = cover ? undefined : art?.motif ?? 'orbit';
  const tone = art?.tone;
  const artStyle = motif
    ? ({ '--cover-from': tone?.from ?? '#d3d9cb', '--cover-to': tone?.to ?? '#8b9c85', '--cover-ink': tone?.ink ?? '#f6f8ec' } as CSSProperties)
    : undefined;
  return (
    <span className={`record-case ${preview ? 'showcase-case' : ''} ${record?.category === 'ambient' ? 'ambient-case' : ''}`} style={{ '--record-color': record?.color ?? '#a0a79d' } as CSSProperties}>
      <span className="case-back" />
      <span className="disc-pocket">
        <Vinyl record={record} color={record?.color ?? '#a0a79d'} cover={cover} spinning={playing} />
      </span>
      <span className="case-front">
        <span className={`cover-art ${record?.category === 'ambient' ? 'cover-ambient' : 'cover-music'} ${motif ? `sleeve-${motif}` : ''}`} style={cover ? { backgroundImage: `url("${cover}")` } : artStyle}>
          {motif && <SleeveMarks motif={motif} />}
        </span>
        <span className="cover-border" />
        <span className="cover-title">{record?.name ?? 'Slow\nmoments.'}</span>
        <span className="case-spine" />
      </span>
    </span>
  );
}
