import { useId, useState } from 'react'
import { Button, Input } from '../../components'
import type { SubmissionDraft, SubmissionProjectFields } from '../../types'
import { submitterRelationLabels } from './form'

type EditorProps = {
  draft: SubmissionDraft
  update: <K extends keyof SubmissionProjectFields>(field: K, value: SubmissionProjectFields[K]) => void
}

function TextArea({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string }) {
  const id = useId()
  return <label className="field" htmlFor={id}>
    <span id={`${id}-label`} className="field__label">{label}</span>
    <textarea id={id} className="input textarea" rows={4} value={value} aria-labelledby={`${id}-label`} aria-invalid={Boolean(error)} aria-describedby={error || hint ? `${id}-description` : undefined} onChange={(event) => onChange(event.target.value)} />
    {error ? <span id={`${id}-description`} className="field__error" role="alert">{error}</span> : hint ? <span id={`${id}-description`} className="field__hint">{hint}</span> : null}
  </label>
}

export function PublicationBasics({ draft, update }: EditorProps) {
  const id = useId()
  return <>
    <section className="submission-guidance"><strong>说明你与作品的关系</strong><p>这项声明用于记录提交来源。作品管理权限仍需通过作者身份验证。</p></section>
    <label className="field" htmlFor={id}>
      <span id={`${id}-label`} className="field__label">提交者关系（必填）</span>
      <select id={id} className="input" value={draft.fields.submitterRelation ?? ''} aria-labelledby={`${id}-label`} aria-invalid={Boolean(draft.validationErrors.submitterRelation)} aria-describedby={draft.validationErrors.submitterRelation ? `${id}-error` : undefined} onChange={(event) => update('submitterRelation', event.target.value as SubmissionProjectFields['submitterRelation'])}>
        <option value="">请选择</option>
        {Object.entries(submitterRelationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {draft.validationErrors.submitterRelation ? <span id={`${id}-error`} className="field__error" role="alert">{draft.validationErrors.submitterRelation}</span> : null}
    </label>
    <Input label="所属团队或开发者（可跳过）" value={draft.fields.organizationName ?? ''} onChange={(event) => update('organizationName', event.target.value)} />
    <Input label="Logo 地址（可跳过）" aria-label="Logo 地址（可跳过）" value={draft.fields.logoUrl ?? ''} error={draft.validationErrors.logoUrl} hint="使用公开的 HTTP 或 HTTPS 图片地址。" onChange={(event) => update('logoUrl', event.target.value || null)} />
  </>
}

export function PublicationDescription({ draft, update }: EditorProps) {
  const [galleryText, setGalleryText] = useState(() => (draft.fields.galleryUrls ?? []).join('\n'))
  return <section className="stack" aria-label="作品介绍与图集">
    <TextArea label="详细介绍（可跳过）" value={draft.fields.detailedDescription ?? ''} onChange={(value) => update('detailedDescription', value)} hint="说明功能、适用场景与优势；测试版本请写明当前可体验范围。" />
    <TextArea label="图集地址（可跳过，每行一张）" value={galleryText} error={draft.validationErrors.galleryUrls} onChange={(value) => { setGalleryText(value); update('galleryUrls', value.split('\n').map((url) => url.trim()).filter(Boolean)) }} hint="添加产品页面或使用场景截图，封面在基础信息中填写。" />
    <Input label="产品视频（可跳过）" aria-label="产品视频（可跳过）" value={draft.fields.videoUrl ?? ''} error={draft.validationErrors.videoUrl} hint="支持 bilibili.com 或 b23.tv 的 HTTPS 视频链接。" onChange={(event) => update('videoUrl', event.target.value || null)} />
  </section>
}

export function PublicationAcknowledgements({ draft, update }: EditorProps) {
  const items = draft.fields.acknowledgements ?? []
  return <section className="stack" aria-labelledby="publication-thanks-heading">
    <div><h3 id="publication-thanks-heading">致谢产品与工具（可跳过）</h3><p>记录参考或使用了哪些产品，并说明它们带来的帮助。</p></div>
    {items.map((item, index) => <fieldset className="submission-choice-field stack" key={index}>
      <legend>致谢 {index + 1}</legend>
      <Input label={`致谢 ${index + 1} 名称`} value={item.name} onChange={(event) => update('acknowledgements', items.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} />
      <Input label={`致谢 ${index + 1} 地址（可跳过）`} value={item.url} onChange={(event) => update('acknowledgements', items.map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry))} />
      <TextArea label={`致谢 ${index + 1} 说明`} value={item.note} onChange={(value) => update('acknowledgements', items.map((entry, i) => i === index ? { ...entry, note: value } : entry))} />
      <Button type="button" onClick={() => update('acknowledgements', items.filter((_, i) => i !== index))}>删除致谢 {index + 1}</Button>
    </fieldset>)}
    {draft.validationErrors.acknowledgements ? <p className="field-error" role="alert">{draft.validationErrors.acknowledgements}</p> : null}
    <div><Button type="button" onClick={() => update('acknowledgements', [...items, { name: '', url: '', note: '' }])}>添加致谢</Button></div>
  </section>
}
