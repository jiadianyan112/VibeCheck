import { Link } from 'react-router-dom'
import { AccessStatusBadge, Tag } from '../components'

const included = ['公开可访问或有可信历史记录的 AI 学习、练习、题库 Web 作品', '能说明目标用户、材料输入、练习方式或反馈闭环的产品原型', '已经结束但仍有源码、模板、组件或提示词可复用的作品']
const excluded = ['仅有想法、没有可核查公开痕迹的概念', '与学习练习闭环无关的通用 AI 工具', '无法在不暴露私人材料的前提下说明来源的档案', '收入、用户规模、市场需求和竞争强度等未经验证的结论']

export function AboutPage() {
  return (
    <main className="about-page page-with-bottom-space">
      <header className="about-hero"><div className="stack"><Tag tone="strong">关于 VibeCheck</Tag><h1>作品社区在前，结构化项目档案在内。</h1><p>VibeCheck 帮助用户查看公开 AI 学习与练习作品如何解决问题、当前是否可访问、发生过哪些变化，以及哪些资产仍可复用。</p></div><aside><strong>一句话边界</strong><p>这里提供可追溯的作品事实和方案差异，不替用户判断市场需求、竞争强度或项目成败。</p></aside></header>

      <div className="page-container about-sections stack">
        <section className="about-split"><div><p className="eyebrow">Scope</p><h2>首期收录范围</h2></div><div className="rule-columns"><div><h3>收录</h3><ul>{included.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>不收录／不声称</h3><ul>{excluded.map((item) => <li key={item}>{item}</li>)}</ul></div></div></section>

        <section className="about-split"><div><p className="eyebrow">Interpretation</p><h2>作品数量不是市场结论</h2></div><div className="stack"><p>同类作品数量只描述当前档案中可检索到的公开样本。数量多不自动意味着竞争激烈，数量少也不自动意味着存在需求或机会。</p><p>访问状态只描述公开入口与可信声明：它不等同收入、活跃度、质量或商业结果。</p><div className="cluster"><AccessStatusBadge status="normal" /><span>表示最近核验时公开入口可访问</span></div><div className="cluster"><AccessStatusBadge status="paused" /><span>表示有可信来源说明作品暂停</span></div><div className="cluster"><AccessStatusBadge status="ended" /><span>表示作品生命周期结束；资产可用性仍单独记录</span></div><div className="cluster"><AccessStatusBadge status="unknown" /><span>表示证据不足，平台不会补猜答案</span></div></div></section>

        <section className="about-split" id="sources"><div><p className="eyebrow">Trust</p><h2>来源与验证时间</h2></div><div className="stack"><p>关键事实同时保留来源类型、来源摘要、采集时间、最后验证时间、可信度和争议状态。过期信息继续显示原始核验时间，不会悄悄改成最新。</p><dl className="definition-list"><div><dt>平台直接核验</dt><dd>编辑在公开页面或公开产品入口中直接观察到的事实。</dd></div><div><dt>已验证作者声明</dt><dd>完成归属验证的作者对作品状态、版本或资产作出的公开声明。</dd></div><div><dt>可信外部来源</dt><dd>公开仓库、发布记录或可追溯第三方材料。</dd></div><div><dt>系统推断</dt><dd>仅作为低可信线索，必须明确标记，不能生成“暂停”“结束”或“失败”结论。</dd></div></dl></div></section>

        <section className="about-split"><div><p className="eyebrow">Ways in</p><h2>档案如何进入平台</h2></div><ol className="numbered-flow"><li><strong>平台建档</strong><p>编辑依据公开资料建立基础档案，作者尚未关联也不影响公共浏览。</p></li><li><strong>作者提交新作品</strong><p>作者先提交公开 URL，系统查重后再进入结构化补充和人工审核。</p></li><li><strong>社区纠错</strong><p>用户可以提交可核查来源，争议字段在审核期间保留原值和争议标记。</p></li></ol></section>

        <section className="about-split" id="author-verification"><div><p className="eyebrow">Ownership</p><h2>已有档案的作者身份验证</h2></div><div className="stack"><p>发现已有档案时，默认路径是继续浏览详情。只有需要管理档案、发布作者声明或提交受控更新时，才需要发起作者身份验证。</p><p>这是低频的管理权限流程，不是查看档案、加入比较或访问公开资产的前置条件。材料只用于归属审核，不在公开页面展示。</p><Link className="button button--secondary" to="/about#corrections">了解纠错与管理边界</Link></div></section>

        <section className="about-split" id="corrections"><div><p className="eyebrow">Corrections</p><h2>纠错方式</h2></div><div className="stack"><p>请提供需要纠正的字段、原始来源 URL、建议值和可以公开核验的说明。平台不会因单次技术检查直接改写生命周期结论。</p><div className="cluster"><Link className="button button--primary" to="/submit?mode=correction">提交纠错线索</Link><Link className="button button--secondary" to="/projects">返回作品广场</Link></div></div></section>
      </div>
    </main>
  )
}
