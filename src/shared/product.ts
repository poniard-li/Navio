// Product naming is deliberately separate from the developer attribution.
// Keep storage/protocol identifiers stable so a display-name change preserves user data.
export const PRODUCT_NAME = 'Navio'
export const DEVELOPER_NAME = 'D.E.X Studio'
export const PRODUCT_NAME_PENDING = false

export function formatProductVersion(version: string): string {
  const release =
    /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-beta\.(0|[1-9]\d*))?$/.exec(version)
  if (!release) return version
  return `Release ${release[1]}${release[2] === undefined ? '' : ` · Public Beta ${release[2]}`}`
}
