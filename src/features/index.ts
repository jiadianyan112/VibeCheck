export interface FeatureRegistration {
  id: string
  description: string
}

export const featureRegistry: FeatureRegistration[] = []
export * from './auth'
export * from './categories'
export * from './comparison'
export * from './submission'
export * from './discovery'
export * from './authorVerification'
export * from './projectUpdate'
export * from './creator'
export * from './personalCenter'
