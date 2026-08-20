import type { Pool, QueryResultRow } from 'pg'

import { catalogError } from './errors.js'

export interface CreatorAccountLinkProjection {
  readonly creator_account_link_id: string
  readonly creator_id: string
  readonly link_role: 'owner' | 'manager'
  readonly permission_profile_ref: Readonly<{
    readonly profile_id: 'OWNER_V1' | 'MANAGER_V1'
    readonly profile_version: 1
    readonly config_hash: string
  }>
  readonly status: 'active' | 'suspended' | 'terminated'
  readonly source_verification_id: string
  readonly version: number
  readonly effective_capabilities: readonly string[]
}

export interface AuthorRelationProjection {
  readonly viewer_schema: 'public' | 'self'
  readonly author_relation_id: string
  readonly project_id: string
  readonly creator_id: string
  readonly author_role: 'owner' | 'co_creator' | 'maintainer'
  readonly status: 'active' | 'suspended' | 'terminated' | 'replaced'
  readonly field_permissions?: readonly string[]
  readonly effective_field_permissions?: readonly string[]
  readonly source_creator_account_link_id?: string | null
  readonly source_verification_id?: string
  readonly version?: number
}

interface LinkRow extends QueryResultRow {
  readonly creator_account_link_id:string;readonly creator_id:string
  readonly link_role:'owner'|'manager';readonly permission_profile_id:'OWNER_V1'|'MANAGER_V1'
  readonly permission_profile_version:number;readonly permission_profile_config_hash:string
  readonly status:'active'|'suspended'|'terminated';readonly source_verification_id:string
  readonly version:string;readonly capabilities_json:unknown
}

interface RelationRow extends QueryResultRow {
  readonly author_relation_id:string;readonly project_id:string;readonly creator_id:string
  readonly author_role:'owner'|'co_creator'|'maintainer'
  readonly status:'active'|'suspended'|'terminated'|'replaced'
  readonly field_permissions_json:unknown;readonly source_verification_id:string
  readonly approved_via_creator_account_link_id:string|null;readonly version:string
  readonly field_path_ceiling_json:unknown
}

export class CreatorAuthorReadService {
  constructor(private readonly pool: Pool) {}

  async getLink(userId:string,linkId:string):Promise<CreatorAccountLinkProjection> {
    this.uuid(userId,'USER_ID_INVALID');this.uuid(linkId,'CREATOR_ACCOUNT_LINK_ID_INVALID')
    const result=await this.pool.query<LinkRow>(`${this.linkSelect()} WHERE link.creator_account_link_id=$1 AND link.user_id=$2`,[linkId,userId])
    if(!result.rows[0]) throw catalogError('CREATOR_ACCOUNT_LINK_NOT_FOUND',404)
    return this.linkProjection(result.rows[0])
  }

  async listMyLinks(userId:string):Promise<readonly CreatorAccountLinkProjection[]> {
    this.uuid(userId,'USER_ID_INVALID')
    const result=await this.pool.query<LinkRow>(`${this.linkSelect()} WHERE link.user_id=$1 ORDER BY link.created_at,link.creator_account_link_id`,[userId])
    return Object.freeze(result.rows.map((row)=>this.linkProjection(row)))
  }

  async getRelation(relationId:string,userId:string|null):Promise<AuthorRelationProjection> {
    this.uuid(relationId,'AUTHOR_RELATION_ID_INVALID')
    const result=await this.pool.query<RelationRow>(`${this.relationSelect()} WHERE relation.author_relation_id=$1`,[relationId])
    const row=result.rows[0]
    if(!row || (row.status!=='active' && !(userId && await this.ownsRelation(userId,row)))) {
      throw catalogError('AUTHOR_RELATION_NOT_FOUND',404)
    }
    return userId && await this.ownsRelation(userId,row) ? this.selfRelation(row) : this.publicRelation(row)
  }

  async listRelations(input:Readonly<{creatorId:string|null;projectId:string|null;userId:string|null}>):Promise<readonly AuthorRelationProjection[]> {
    if ((input.creatorId===null)===(input.projectId===null)) throw catalogError('AUTHOR_RELATION_FILTER_INVALID',422)
    const id=this.uuid(input.creatorId??input.projectId!,'AUTHOR_RELATION_FILTER_INVALID')
    const column=input.creatorId?'creator_id':'project_id'
    const result=await this.pool.query<RelationRow>(`${this.relationSelect()} WHERE relation.${column}=$1 ORDER BY relation.created_at,relation.author_relation_id`,[id])
    const projections:AuthorRelationProjection[]=[]
    for(const row of result.rows){
      if(input.userId && await this.ownsRelation(input.userId,row)) projections.push(this.selfRelation(row))
      else if(row.status==='active') projections.push(this.publicRelation(row))
    }
    return Object.freeze(projections)
  }

  private linkSelect():string{return `SELECT link.*,profile.capabilities_json FROM catalog.creator_account_links link JOIN catalog.link_permission_profiles profile ON profile.profile_id=link.permission_profile_id AND profile.profile_version=link.permission_profile_version AND profile.config_hash=link.permission_profile_config_hash`}
  private relationSelect():string{return `SELECT relation.*,profile.field_path_ceiling_json FROM catalog.author_relations relation LEFT JOIN catalog.creator_account_links link ON link.creator_account_link_id=relation.approved_via_creator_account_link_id LEFT JOIN catalog.link_permission_profiles profile ON profile.profile_id=link.permission_profile_id AND profile.profile_version=link.permission_profile_version AND profile.config_hash=link.permission_profile_config_hash`}
  private async ownsRelation(userId:string,row:RelationRow):Promise<boolean>{
    const result=await this.pool.query<{present:boolean}>(`SELECT EXISTS(SELECT 1 FROM catalog.creator_account_links WHERE user_id=$1 AND creator_id=$2 AND status='active') AS present`,[userId,row.creator_id])
    return result.rows[0]?.present===true
  }
  private linkProjection(row:LinkRow):CreatorAccountLinkProjection{return Object.freeze({
    creator_account_link_id:row.creator_account_link_id,creator_id:row.creator_id,link_role:row.link_role,
    permission_profile_ref:Object.freeze({profile_id:row.permission_profile_id,profile_version:1,config_hash:row.permission_profile_config_hash}),
    status:row.status,source_verification_id:row.source_verification_id,version:Number(row.version),
    effective_capabilities:Object.freeze([...this.strings(row.capabilities_json)]),
  })}
  private publicRelation(row:RelationRow):AuthorRelationProjection{return Object.freeze({viewer_schema:'public',author_relation_id:row.author_relation_id,project_id:row.project_id,creator_id:row.creator_id,author_role:row.author_role,status:'active'})}
  private selfRelation(row:RelationRow):AuthorRelationProjection{
    const requested=this.strings(row.field_permissions_json);const ceiling=row.field_path_ceiling_json===null?[]:this.strings(row.field_path_ceiling_json)
    return Object.freeze({viewer_schema:'self',author_relation_id:row.author_relation_id,project_id:row.project_id,creator_id:row.creator_id,author_role:row.author_role,status:row.status,field_permissions:Object.freeze([...requested]),effective_field_permissions:Object.freeze(requested.filter((path)=>ceiling.includes(path))),source_creator_account_link_id:row.approved_via_creator_account_link_id,source_verification_id:row.source_verification_id,version:Number(row.version)})
  }
  private strings(value:unknown):readonly string[]{if(!Array.isArray(value)||value.some((item)=>typeof item!=='string'))throw catalogError('CATALOG_AUTHORIZATION_INVALID',500,true);return value as string[]}
  private uuid(value:string,code:string):string{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw catalogError(code,422);return value.toLowerCase()}
}
