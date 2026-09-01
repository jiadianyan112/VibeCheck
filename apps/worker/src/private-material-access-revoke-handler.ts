import type { OutboxEvent } from '@vibecheck/database'

export interface PrivateMaterialAccessRevoker {
  revoke(materialId:string):Promise<void>
}

export function createPrivateMaterialAccessRevokeHandler(revoker:PrivateMaterialAccessRevoker){
  return async(event:OutboxEvent):Promise<void>=>{
    if(event.eventName!=='verification_material_access_revoke_requested'||
      event.aggregateType!=='verification_material'||event.aggregateId.length!==36){
      throw new Error('PRIVATE_MATERIAL_REVOKE_EVENT_INVALID')
    }
    await revoker.revoke(event.aggregateId)
  }
}
