import { ArrowRight } from 'lucide-react';

/** 使用说明：四步走完整个流程。 */
export default function GuideModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <h2 id="modal-title">使用说明</h2>
      <div className="guide-steps">
        <p>
          <span>01</span>
          <strong>收藏</strong>音频文件或整个文件夹，音乐与环境音分开收。
        </p>
        <p>
          <span>02</span>
          <strong>打开唱片盒</strong>鼠标停留或点一下，看介绍。
        </p>
        <p>
          <span>03</span>
          <strong>加入此刻</strong>点 ＋ 选择。数字是播放顺序，环境音同时循环。
        </p>
        <p>
          <span>04</span>
          <strong>微调</strong>「正在听」里改顺序，环境音的「声音微调」调避让幅度。
        </p>
      </div>
      <button className="primary-button full-width" onClick={onClose}>
        知道了
        <ArrowRight size={14} />
      </button>
    </>
  );
}
