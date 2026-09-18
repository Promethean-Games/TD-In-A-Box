function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export function getAppBasePath(): string {
  return normalizeBasePath(import.meta.env.BASE_URL || '/')
}

export function getPublicAssetPath(assetPath: string): string {
  const cleanAssetPath = assetPath.replace(/^\/+/, '')
  return `${getAppBasePath()}${cleanAssetPath}`
}

export function getAppRouteUrl(routePath: string): string {
  const normalizedRoutePath = routePath.startsWith('/') ? routePath : `/${routePath}`

  if (typeof window === 'undefined') {
    return `${getAppBasePath()}#${normalizedRoutePath}`
  }

  return `${window.location.origin}${getAppBasePath()}#${normalizedRoutePath}`
}
