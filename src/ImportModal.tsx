import { ArrowDownToLine, Check, FolderOpen, LoaderCircle, Music2, Waves } from 'lucide-react';
import type { RecordType } from './records';

/**
 * 收藏声音：先选收成哪一种，再选文件。
 *
 * 两种类型放在最上面而不是做成两个入口，因为「我这次收的是什么」决定了
 * 后面的播放行为（音乐排顺序、环境音叠加），选错要回头删掉重收。
 */
export default function ImportModal({ importType, busy, ready, report, onType, onFiles, onFolder }: {
  importType: RecordType;
  busy: string;
  ready: boolean;
  report: string[];
  onType: (type: RecordType) => void;
  onFiles: () => void;
  onFolder: () => void;
}) {
  return (
    <>
      <h2>收藏声音</h2>
      <div className="import-types">
        <button className={importType === 'music' ? 'selected' : ''} disabled={!!busy} onClick={() => onType('music')}>
          <Music2 size={22} />
          <strong>音乐唱片</strong>
          <small>多选后，按顺序播放</small>
          {importType === 'music' && <Check size={12} />}
        </button>
        <button className={importType === 'ambient' ? 'selected' : ''} disabled={!!busy} onClick={() => onType('ambient')}>
          <Waves size={22} />
          <strong>环境音唱片</strong>
          <small>多路循环，一起流动</small>
          {importType === 'ambient' && <Check size={12} />}
        </button>
      </div>
      <button className="primary-button full-width" disabled={!!busy || !ready} onClick={onFiles}>
        {busy ? <LoaderCircle size={15} className="loading-spin" /> : <ArrowDownToLine size={15} />}
        {busy || '选择本地音频'}
      </button>
      <button className="secondary-button full-width" disabled={!!busy || !ready} onClick={onFolder}>
        <FolderOpen size={15} />
        导入整个文件夹
      </button>
      <p className="import-help">
        {importType === 'ambient' ? '单张不超过 50 MB / 10 分钟，最多叠加 8 路。' : '单张不超过 200 MB，支持 MP3、WAV、FLAC。'}
        <br />
        重复文件会自动跳过。
      </p>
      {report.length > 0 && (
        <div role="alert" className="import-report">
          <strong>这些文件暂时没有收藏成功</strong>
          {report.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </div>
      )}
    </>
  );
}
