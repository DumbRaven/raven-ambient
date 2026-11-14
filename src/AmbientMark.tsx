import { Waves } from 'lucide-react';
import { coverMarks } from './cover-marks';
import type { RecordItem } from './records';

/** 环境音的小标识：选了内置封面就画那张封面的主图形，否则用波浪纹。 */
export default function AmbientMark({ record }: { record?: RecordItem }) {
  const mark = record ? coverMarks[record.coverPreset ?? ''] : undefined;
  if (!mark) return <Waves size={13} />;
  return <svg className="ambient-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark }} />;
}
