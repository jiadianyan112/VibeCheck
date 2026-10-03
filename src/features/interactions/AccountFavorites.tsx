import { Link } from 'react-router-dom'
import { Button, EmptyState } from '../../components'
import { useProjectInteractions } from './ProjectInteractionContext'
import { useFavoriteProjects } from './useFavoriteProjects'

export function AccountFavorites() {
  const { projects, loading, error, nextCursor, refresh, loadMore } = useFavoriteProjects()
  const interactions = useProjectInteractions(projects)
  return <>
    {error ? <div role="alert"><p>{error}</p><Button onClick={() => void refresh()}>重新读取收藏</Button></div> : null}
    {projects.length ? <ul className="personal-item-list">{projects.map(project => <li key={project.id}>
      <div><strong><Link to={`/project/${project.id}`}>{project.currentName.state === 'known' ? project.currentName.value : '名称未知作品'}</Link></strong><p>{project.oneLineDefinition.state === 'known' ? project.oneLineDefinition.value : '作品定义待补充。'}</p></div>
      <div className="cluster"><Button disabled={interactions.busy(project) || !interactions.ready(project)} aria-pressed={interactions.followed(project)} onClick={() => interactions.toggleFollow(project)}>{interactions.followed(project) ? '取消关注更新' : '关注更新'}</Button><Button disabled={interactions.busy(project) || !interactions.ready(project)} onClick={() => interactions.toggleFavorite(project, false)}>取消收藏</Button><Link className="button button--secondary" to={`/project/${project.id}`}>进入作品</Link></div>
    </li>)}</ul> : loading ? <p role="status">正在读取收藏…</p> : !error ? <EmptyState title="还没有收藏作品" description="收藏后可以从这里快速返回作品，并按需关注更新。" action={<Link className="button button--secondary" to="/projects">浏览作品广场</Link>} /> : null}
    {nextCursor ? <Button disabled={loading} onClick={() => void loadMore()}>{loading ? '正在读取…' : '加载更多收藏'}</Button> : null}
  </>
}
