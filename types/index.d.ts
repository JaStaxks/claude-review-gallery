export type ReviewKind = 'image' | 'video' | 'file'

export type ReviewItem = {
  /** tool_use_id plus the file's index in that call */
  id: string
  /** absolute path of the file Claude sent */
  path: string
  name: string
  kind: ReviewKind
  caption?: string
  /** ms since epoch when it was sent */
  at: number
  /** preview bytes, base64 (images and videos) */
  thumb?: string
  /** the preview's media type, image/webp */
  mime?: string
  /** PNG preview on disk, for the terminal's Image */
  thumbPng?: string
  /** an SVG file's own markup, when small enough to draw directly */
  svg?: string
  w?: number
  h?: number
  /** why no preview could be made */
  note?: string
}

declare module 'claude-code' {
  interface PluginState {
    'review-gallery': { items: Shaped<ReviewItem[]> }
  }
}
