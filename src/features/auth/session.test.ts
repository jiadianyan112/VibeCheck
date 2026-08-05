import { prototypeUsers } from '../../mocks'
import { createInitialAppState } from '../../state/initialState'
import { appReducer } from '../../state/reducer'
import { createLoginAction, isStaffRole, roleLabels } from './session'

describe('prototype login identities', () => {
  it('hydrates the fixed registered user from shared mock indexes', () => {
    const user = prototypeUsers[0]!
    const action = createLoginAction(user)
    expect(action.assets?.favoriteProjectIds).toHaveLength(3)
    expect(action.assets?.submissionDrafts[0]?.userId).toBe(user.id)
    expect(action.assets?.notifications.every((notification) => notification.userId === user.id)).toBe(true)
  })

  it('keeps the verified author identity distinct from staff permissions', () => {
    const author = prototypeUsers[1]!
    const state = appReducer(createInitialAppState(), createLoginAction(author))
    expect(roleLabels[state.session.role]).toBe('已验证作者')
    expect(state.session.user?.creatorId).toBeTruthy()
    expect(isStaffRole(state.session.role)).toBe(false)
  })

  it('grants the staff gate only to editor and admin roles', () => {
    expect(isStaffRole('guest')).toBe(false)
    expect(isStaffRole('user')).toBe(false)
    expect(isStaffRole('verified_author')).toBe(false)
    expect(isStaffRole('editor')).toBe(true)
    expect(isStaffRole('admin')).toBe(true)
  })
})
