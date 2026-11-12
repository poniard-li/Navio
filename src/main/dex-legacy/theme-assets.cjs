'use strict'
const { createHash } = require('node:crypto')
const IMAGE_LIMIT = 8 * 1024 * 1024
const VIDEO_LIMIT = 32 * 1024 * 1024
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function pngCrc(data) {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function mp4Boxes(data, start = 0, end = data.length) {
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    let size = data.readUInt32BE(offset),
      header = 8
    const type = data.toString('ascii', offset + 4, offset + 8)
    if (size === 1) {
      if (offset + 16 > end) throw new Error('MP4 文件不完整')
      const large = data.readBigUInt64BE(offset + 8)
      if (large > BigInt(VIDEO_LIMIT)) throw new Error('MP4 块过大')
      size = Number(large)
      header = 16
    }
    if (size === 0) size = end - offset
    if (size < header || size > end - offset) throw new Error('MP4 块长度无效')
    boxes.push({ type, start: offset + header, end: offset + size })
    offset += size
  }
  if (offset !== end) throw new Error('MP4 文件不完整')
  return boxes
}
function dimensions(width, height) {
  if (!width || !height || width > 8192 || height > 8192 || width * height > 32000000)
    throw new Error('图片尺寸超过 8192 像素或 3200 万像素')
}
/** Inspect file signatures and container boundaries; never trust the supplied extension or MIME. */
function inspectThemeAsset(input, expected) {
  const data = Buffer.from(input)
  if (data.length < 12 || data.length > VIDEO_LIMIT) throw new Error('媒体文件为空或超过 32 MB')
  let mime
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (
      data.length < 33 ||
      data.readUInt32BE(8) !== 13 ||
      data.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('PNG 文件不完整')
    dimensions(data.readUInt32BE(16), data.readUInt32BE(20))
    let offset = 8,
      ended = false,
      imageData = false
    while (offset + 12 <= data.length) {
      const size = data.readUInt32BE(offset),
        type = data.toString('ascii', offset + 4, offset + 8)
      if (size > data.length - offset - 12) throw new Error('PNG 数据长度无效')
      if (type === 'acTL') throw new Error('请使用静态 PNG，动态背景请选择视频')
      if (type === 'IHDR' && offset !== 8) throw new Error('PNG 重复的文件头')
      if (
        pngCrc(data.subarray(offset + 4, offset + 8 + size)) !==
        data.readUInt32BE(offset + 8 + size)
      )
        throw new Error('PNG 校验码无效')
      if (type === 'IDAT' && size > 0) imageData = true
      if (type === 'IEND' && size !== 0) throw new Error('PNG 结束块无效')
      offset += size + 12
      if (type === 'IEND') {
        ended = offset === data.length
        break
      }
    }
    if (!ended || !imageData) throw new Error('PNG 文件不完整')
    mime = 'image/png'
  } else if (data[0] === 0xff && data[1] === 0xd8 && data.at(-2) === 0xff && data.at(-1) === 0xd9) {
    let offset = 2,
      found = false
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) throw new Error('JPEG 标记无效')
      while (data[offset] === 0xff) offset++
      const marker = data[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length) throw new Error('JPEG 文件不完整')
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        dimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3))
        found = true
      }
      offset += length
    }
    if (!found) throw new Error('JPEG 缺少有效尺寸')
    mime = 'image/jpeg'
  } else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    if (data.readUInt32LE(4) + 8 !== data.length || data.length < 25)
      throw new Error('WebP 文件不完整')
    const type = data.toString('ascii', 12, 16)
    if (type === 'VP8X' && data.length >= 30) {
      if (data[20] & 2) throw new Error('请使用静态 WebP，动态背景请选择视频')
      dimensions(1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3))
    } else if (type === 'VP8L' && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21)
      dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
    } else if (
      type === 'VP8 ' &&
      data.length >= 30 &&
      data.subarray(23, 26).equals(Buffer.from([0x9d, 1, 0x2a]))
    )
      dimensions(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff)
    else throw new Error('不支持的 WebP 数据')
    mime = 'image/webp'
  } else if (data.toString('ascii', 4, 8) === 'ftyp') {
    const boxes = mp4Boxes(data)
    const ftyp = boxes[0]
    if (ftyp.end - ftyp.start < 8 || (ftyp.end - ftyp.start) % 4 !== 0)
      throw new Error('MP4 文件类型无效')
    const brands = [data.toString('ascii', ftyp.start, ftyp.start + 4)]
    for (let i = ftyp.start + 8; i < ftyp.end; i += 4) brands.push(data.toString('ascii', i, i + 4))
    if (
      !brands.some((brand) =>
        [
          'isom',
          'iso2',
          'iso4',
          'iso5',
          'iso6',
          'mp41',
          'mp42',
          'avc1',
          'M4V ',
          'MSNV',
          'dash'
        ].includes(brand)
      )
    )
      throw new Error('不支持的 MP4 文件类型')
    let videoTrack = false
    for (const moov of boxes.filter((box) => box.type === 'moov')) {
      for (const track of mp4Boxes(data, moov.start, moov.end).filter(
        (box) => box.type === 'trak'
      )) {
        for (const mdia of mp4Boxes(data, track.start, track.end).filter(
          (box) => box.type === 'mdia'
        )) {
          videoTrack ||= mp4Boxes(data, mdia.start, mdia.end).some(
            (box) =>
              box.type === 'hdlr' &&
              box.end - box.start >= 12 &&
              data.toString('ascii', box.start + 8, box.start + 12) === 'vide'
          )
        }
      }
    }
    if (!videoTrack || !boxes.some((box) => box.type === 'mdat' && box.end > box.start))
      throw new Error('MP4 缺少视频容器数据')
    mime = 'video/mp4'
  } else if (
    data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
    data.subarray(0, 4096).includes(Buffer.from('webm')) &&
    data.includes(Buffer.from([0x18, 0x53, 0x80, 0x67]))
  )
    mime = 'video/webm'
  else throw new Error('仅支持真实 PNG、JPEG、静态 WebP、MP4 或 WebM 文件')
  if (mime.startsWith('image/') && data.length > IMAGE_LIMIT) throw new Error('图片文件超过 8 MB')
  const asset = { sha256: createHash('sha256').update(data).digest('hex'), mime, size: data.length }
  if (
    expected &&
    (asset.sha256 !== expected.sha256 ||
      asset.mime !== expected.mime ||
      asset.size !== expected.size)
  )
    throw new Error('媒体资源校验不一致')
  return asset
}
function validateAsset(asset, kind) {
  if (
    !asset ||
    typeof asset !== 'object' ||
    Array.isArray(asset) ||
    Object.keys(asset).sort().join(',') !== 'mime,sha256,size' ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'].includes(asset.mime) ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > (asset.mime.startsWith('video/') ? VIDEO_LIMIT : IMAGE_LIMIT) ||
    (kind && !asset.mime.startsWith(kind + '/'))
  )
    throw new Error('媒体资源信息无效')
  return structuredClone(asset)
}
function validateBackground(bg) {
  if (!bg || typeof bg !== 'object' || Array.isArray(bg)) throw new Error('背景参数无效')
  if (['solid', 'gradient'].includes(bg.type)) {
    if (
      Object.keys(bg).some((key) => !['type', 'colors', 'angle'].includes(key)) ||
      !Array.isArray(bg.colors) ||
      bg.colors.length < (bg.type === 'solid' ? 1 : 2) ||
      bg.colors.length > (bg.type === 'solid' ? 1 : 4) ||
      bg.colors.some((c) => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) ||
      (bg.angle !== undefined && (!Number.isFinite(bg.angle) || bg.angle < 0 || bg.angle > 360))
    )
      throw new Error('纯色或渐变参数无效')
  } else if (['image', 'video'].includes(bg.type)) {
    if (
      Object.keys(bg).some(
        (key) =>
          !['type', 'asset', 'opacity', 'fit', ...(bg.type === 'video' ? ['poster'] : [])].includes(
            key
          )
      ) ||
      (bg.opacity !== undefined &&
        (!Number.isFinite(bg.opacity) || bg.opacity < 0 || bg.opacity > 1)) ||
      (bg.fit !== undefined && !['cover', 'contain'].includes(bg.fit))
    )
      throw new Error('媒体背景参数无效')
    validateAsset(bg.asset, bg.type)
    if (bg.type === 'video') validateAsset(bg.poster, 'image')
  } else throw new Error('不支持的背景类型')
  return structuredClone(bg)
}
function themeAssets(theme) {
  const bg = theme.background
  return bg?.type === 'image' ? [bg.asset] : bg?.type === 'video' ? [bg.asset, bg.poster] : []
}
module.exports = { inspectThemeAsset, validateBackground, themeAssets, IMAGE_LIMIT, VIDEO_LIMIT }
