import { Link } from 'react-router-dom'
import { AccessStatusBadge, Tag } from '../components'

const included = ['公开可访问或有可信历史记录的 AI 学习、练习、题库 Web 作品', '公开可访问、围绕明确个人身份，并有主页／项目／经历等实质结构的个人主页与作品集', '有作者声明或公开证据确认由 AI 编程工具辅助开发的独立 Web 作品', '已经结束但仍有源码、Starter、模板、布局、组件或提示词可复用的作品']
const excluded = ['仅有想法、没有可核查公开痕迹的概念', '企业或产品官网、纯博客、纯 Link-in-bio、单张电子名片、招聘平台主页、Notion 公开页、社交主页或纯 PDF 简历', '需要登录才能查看主要内容，或无法确认 AI 辅助开发的个人网站', '无法在不暴露私人材料的前提下说明来源的档案', '收入、用户规模、市场需求和竞争强度等未经验证的结论']

export function AboutPage() {
  return (
    <main className="about-page page-with-bottom-space">
      <header className="about-hero"><div className="stack"><Tag tone="strong">关于 VibeCheck</Tag><h1>发现作品，也看懂它是怎么做的。</h1><p>VibeCheck 并列收录 AI 学习与题库、个人主页与作品集两类 Vibe Coding 作品，帮助你了解定位、结构、实现、当前状态和可复用内容。</p></div><aside><strong>我们提供什么</strong><p>这里提供有来源的作品信息和品类内方案差异，但不替你判断市场需求、竞争强度或项目成败。</p></aside></header>

      <div className="page-container about-sections stack">
        <section className="about-split" id="rules"><div><h2>收录范围</h2></div><div className="rule-columns"><div><h3>收录</h3><ul>{included.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>不收录／不声称</h3><ul>{excluded.map((item) => <li key={item}>{item}</li>)}</ul></div></div></section>

        <section className="about-split"><div><h2>作品数量不是市场结论</h2></div><div className="stack"><p>同类作品数量只表示社区目前收录的公开作品。数量多不等于竞争激烈，数量少也不代表一定存在机会。</p><p>访问状态只描述公开入口是否可用，不代表收入、活跃度、质量或商业结果。</p><div className="cluster"><AccessStatusBadge status="normal" /><span>最近检查时公开入口可以访问</span></div><div className="cluster"><AccessStatusBadge status="paused" /><span>有可信信息说明作品暂停维护</span></div><div className="cluster"><AccessStatusBadge status="ended" /><span>作品已经结束，但公开资源仍可能继续使用</span></div><div className="cluster"><AccessStatusBadge status="unknown" /><span>暂时没有足够信息确认状态</span></div></div></section>

        <section className="about-split" id="sources"><div><h2>来源与验证时间</h2></div><div className="stack"><p>重要信息会标明来源和最近验证时间。信息过期后仍会显示原来的日期，方便你判断是否继续参考。</p><dl className="definition-list"><div><dt>平台直接核验</dt><dd>编辑在公开页面或作品入口中直接看到的信息。</dd></div><div><dt>已验证作者声明</dt><dd>完成身份验证的作者提供的作品状态、版本或资源信息。</dd></div><div><dt>可信外部来源</dt><dd>公开仓库、发布记录或可以追溯的第三方材料。</dd></div><div><dt>待确认线索</dt><dd>只用于提示可能的变化，在确认前不会写成作品已经暂停、结束或失败。</dd></div></dl></div></section>

        <section className="about-split"><div><h2>作品如何进入社区</h2></div><ol className="numbered-flow"><li><strong>平台收录</strong><p>编辑根据公开资料建立基础档案，作者还未关联时也可以正常浏览。</p></li><li><strong>作者发布</strong><p>提交公开地址并确认社区中没有重复作品后，再补充介绍并等待审核。</p></li><li><strong>社区纠错</strong><p>任何用户都可以提供公开来源，帮助我们补充或纠正作品信息。</p></li></ol></section>

        <section className="about-split" id="author-verification"><div><h2>认领已有作品</h2></div><div className="stack"><p>如果社区里已经有你的作品，可以先正常浏览。只有在你需要更新作品信息或发布作者声明时，才需要验证作者身份。</p><p>验证材料只用于确认作品归属，不会公开展示。浏览、比较和使用公开资源都不需要先完成验证。</p><Link className="button button--secondary" to="/about#corrections">了解纠错与作品管理</Link></div></section>

        <section className="about-split" id="corrections"><div><h2>发现信息有误？</h2></div><div className="stack"><p>请告诉我们哪一项需要修改，并附上公开来源和建议内容。核对完成前，当前信息和争议提示都会继续保留。</p><div className="cluster"><Link className="button button--primary" to="/submit?mode=correction">提交纠错信息</Link><Link className="button button--secondary" to="/projects">返回作品广场</Link></div></div></section>
      </div>
    </main>
  )
}
