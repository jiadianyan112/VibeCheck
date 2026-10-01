import type { Pool } from 'pg'

import { privateMaterialError } from './errors.js'
import type { PrivateMaterialStorage } from './types.js'
import type { PrivateMaterialStorageKeyResolver } from './service.js'
import type { StoredMaterial } from './store.js'

export class PostgresPrivateMaterialAccessRevoker {
  constructor(private readonly dependencies:Readonly<{
    pool:Pool;storage:Pick<PrivateMaterialStorage,'denyReads'>;
    resolveStorageKey:PrivateMaterialStorageKeyResolver
  }>){ }

  async revoke(materialId:string):Promise<void>{
    const result=await this.dependencies.pool.query<StoredMaterial>(
      `SELECT * FROM private_material.verification_materials WHERE material_id=$1`,[materialId],
    )
    const material=result.rows[0]
    if(!material)throw privateMaterialError('VERIFICATION_MATERIAL_NOT_FOUND',404)
    if(!['revoked','deleted'].includes(material.status)){
      throw privateMaterialError('VERIFICATION_MATERIAL_REVOKE_STATE_INVALID',409)
    }
    await this.dependencies.storage.denyReads({storageKey:this.dependencies.resolveStorageKey(material)})
  }
}
