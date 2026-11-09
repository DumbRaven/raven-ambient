/**
 * 桌面放映窗的入口。整个窗口只画一件事：放映台本身。
 *
 * 它和主窗口是两个渲染进程，拿不到那边的 React 状态，所以走 desktop-bridge.ts
 * 那一套「主进程搬东西」的路子：先把 window 上的快照画出来，之后主进程每
 * 一段时间推一份新的过来就重画。
 *
 * 为什么不复用 MediaRoom：那个组件里有格子、工具栏、添加菜单、配色面板……
 * 桌面窗一个都不要，而且它自带一层「这一页是不是显示着」的状态管理。
 * 真正要复用的只有版式本身，那已经是 TemplateStage 一个组件了。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
// 顺序有意义：同优先级时后加载的赢，皮肤层必须在原样式之后。
import './skin-bold.css';
import './desktop.css';
import TemplateStage from './TemplateStage';
import LayerStack from './LayerStack';
import RainLayer from './RainLayer';
import { installStageDrain, installStagePaint, sendStageCommand, type StageSnapshot } from './desktop-bridge';

function DesktopStage() {
  const [snapshot, setSnapshot] = useState<StageSnapshot | null>(null);
  const screen = useRef<HTMLVideoElement>(null);

  // 主进程推快照过来。先注册再等第一份：晚于第一份注册就会永远停在空台面上。
  useEffect(() => installStagePaint(next => setSnapshot(next)), []);

  // 桌面窗上按下的东西攒进队列，主进程定时来取。
  useEffect(() => {
    installStageDrain();
  }, []);

  const toggleStone = useCallback(() => sendStageCommand({ type: 'stone' }), []);
  const prevTrack = useCallback(() => sendStageCommand({ type: 'prev' }), []);
  const nextTrack = useCallback(() => sendStageCommand({ type: 'next' }), []);

  // 快照还没到的那一两百毫秒里是一块纯背景色，不放任何占位文字——
  // 这个窗口是从主界面「放到桌面」开出来的，用户已经知道自己点了什么。
  if (!snapshot || !snapshot.item) return <div className="desktop-stage desktop-stage-blank" />;

  return (
    <section className="media-room is-expanded desktop-stage" data-chrome="hidden" aria-label="桌面放映">
      <div className="media-theater" data-kind={snapshot.item.kind} data-template={snapshot.template}>
        <div className="theater-screen">
          <TemplateStage
            item={snapshot.item}
            template={snapshot.template}
            videoRef={screen}
            onPlayState={() => { /* 桌面窗没有播放按钮，播放状态由主窗口管 */ }}
            index={snapshot.index}
            total={snapshot.total}
            disc={snapshot.disc}
            focus={snapshot.focus}
            ambience={snapshot.ambience}
            now={snapshot.now}
            hint={snapshot.hint}
            stone={snapshot.stone}
            onStone={toggleStone}
            onPrevTrack={snapshot.canPrev ? prevTrack : undefined}
            onNextTrack={snapshot.canNext ? nextTrack : undefined}
            /* 色板由主窗口算好了传过来：这里自己取色会对 4K 视频再解一帧。 */
            colors={snapshot.palette}
            /* 图层只有一份，皮肤跟着版式走：透明版式用壁纸上的白字，其余用深色小字。
               这边也能拖、也能删——这个窗口就是用户平时看着的那块，要调整位置当然在这里调。
               松手后整份表回传主窗口落盘（存档只有主窗口那份）。 */
            widgets={
              <LayerStack
                value={snapshot.layers}
                onChange={value => sendStageCommand({ type: 'layers', value })}
                remaining={snapshot.focusLeft}
                now={snapshot.now}
                disc={snapshot.disc}
                title={snapshot.title}
                editable
                skin={snapshot.template === 'desktop' ? 'widgets' : 'overlay'}
                big
              />
            }
          />
          <RainLayer value={snapshot.rain} />
        </div>
      </div>
    </section>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<DesktopStage />);
