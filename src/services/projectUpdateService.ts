import { applyProjectUpdate, type ProjectUpdateInput } from '../features/projectUpdate'
import type { Project, PrototypeUser } from '../types'
import { runService, type ServiceOptions } from './runtime'
import type { ServiceResult } from './result'

export const projectUpdateService = {
  submit(project: Project, user: PrototypeUser, input: ProjectUpdateInput, options?: ServiceOptions): Promise<ServiceResult<ReturnType<typeof applyProjectUpdate>>> {
    if (options?.scenario === 'permission_expired') {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'VC_UPDATE_PERMISSION_EXPIRED',
          kind: 'forbidden',
          message: '作者管理权限已失效，当前草稿已保留；请重新完成身份验证。',
          retryable: false,
        },
      })
    }
    return runService(options, () => applyProjectUpdate(project, user, input))
  },
}
