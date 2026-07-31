export interface FeatureRegistration {
  id: string
  description: string
}

export const featureRegistry: FeatureRegistration[] = []
export * from './auth'
