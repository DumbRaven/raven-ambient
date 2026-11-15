import { type RefObject } from 'react';
import { Check, CheckCheck, ImagePlus, Sparkles, Trash2 } from 'lucide-react';
import { ambientCovers, ambientCoverUrl, type AmbientCover } from './ambient-covers';
import type { RecordItem } from './records';

export type EditDraft = { name: string; artist: string; description: string };

/**
 * 编辑唱片：名称、作者、介绍，环境音还多一个本地封面库。
 *
 * 表单在提交前不写库——用户改到一半点别处关掉，不该已经改掉了名字。
 * 名称是唯一必填项：没有名字的唱片在柜子里就是一个色块，找不回来。
 * 校验失败时抖一下输入框而不是只显示一行红字，让眼睛知道该看哪里。
 */
export default function EditModal({ record, draft, draftError, busy, confirming, nameInputRef, onDraft, onSubmit, onChooseCover, onAutoCover, onUploadCover, onRemove }: {
  record: RecordItem;
  draft: EditDraft;
  draftError: string;
  busy: string;
  /** 已经点过一次「从唱片柜移除」，这颗按钮现在是红色的确认态。 */
  confirming: boolean;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onDraft: (next: EditDraft) => void;
  onSubmit: () => void;
  onChooseCover: (cover: AmbientCover) => void;
  onAutoCover: () => void;
  onUploadCover: () => void;
  onRemove: () => void;
}) {
  /** 提交失败时抖一下名称输入框：每次调用都是独立动画，连续失败也能重播。 */
  function shake() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    nameInputRef.current?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(-2px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    nameInputRef.current?.focus();
  }

  return (
    <>
      <h2 id="modal-title">编辑唱片</h2>
      <form
        onSubmit={e => {
          e.preventDefault();
          if (!draft.name.trim()) {
            shake();
            return;
          }
          onSubmit();
        }}
        noValidate
      >
        <label className="text-field" data-invalid={draftError ? 'true' : undefined}>
          唱片名称
          <input
            ref={nameInputRef}
            value={draft.name}
            maxLength={100}
            required
            aria-invalid={draftError ? true : undefined}
            aria-describedby={draftError ? 'record-name-error' : undefined}
            onChange={e => onDraft({ ...draft, name: e.target.value })}
          />
          {draftError && (
            <span className="field-error" id="record-name-error" role="alert">
              {draftError}
            </span>
          )}
        </label>
        <label className="text-field">
          作者
          <input value={draft.artist} maxLength={100} onChange={e => onDraft({ ...draft, artist: e.target.value })} />
        </label>
        <label className="text-field">
          一段介绍
          <textarea placeholder="它让你想起了什么？" value={draft.description} maxLength={500} rows={4} onChange={e => onDraft({ ...draft, description: e.target.value })} />
        </label>

        {record.category === 'ambient' && (
          <section className="cover-library" aria-label="环境音封面库">
            <div className="cover-library-heading">
              <h3>本地封面库</h3>
              <span>{ambientCovers.length} 款声音小景</span>
            </div>
            <p>点选即可换上封面，也可以上传自己的图片。</p>
            <div className="cover-options">
              {ambientCovers.map(cover => (
                <button type="button" key={cover.id} className={record.coverPreset === cover.id ? 'chosen' : ''} aria-label={'使用' + cover.name + '封面'} aria-pressed={record.coverPreset === cover.id} disabled={!!busy} onClick={() => onChooseCover(cover)}>
                  <img src={ambientCoverUrl(cover.id)} alt="" loading="lazy" />
                  <span>{cover.name}</span>
                  {record.coverPreset === cover.id && <Check size={12} />}
                </button>
              ))}
            </div>
            <button type="button" className="text-button" disabled={!!busy} onClick={onAutoCover}>
              <Sparkles size={12} />
              按唱片名称重新匹配
            </button>
          </section>
        )}

        <button type="button" className="secondary-button full-width" disabled={!!busy} onClick={onUploadCover}>
          <ImagePlus size={15} />
          {busy || '上传自己的封面'}
        </button>
        <button type="submit" className="primary-button full-width" disabled={!!busy}>
          <CheckCheck size={15} />
          保存介绍
        </button>
      </form>
      {/* 两段确认，和右侧介绍栏那颗删除按钮同一套：第一下变红，第二下才真删。
          这里本来是一下直删——它紧贴着「保存介绍」，误触代价是一张唱片的名字、
          作者、介绍、封面引用一起没了，而旁边同功能的入口都要点两下。 */}
      <button
        type="button"
        className={`text-button remove-record ${confirming ? 'armed' : ''}`}
        disabled={!!busy}
        onClick={onRemove}
      >
        <Trash2 size={12} />
        {confirming ? '再点一下，真的移出' : '从唱片柜移除'}
      </button>
    </>
  );
}
