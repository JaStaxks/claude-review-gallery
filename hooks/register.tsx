import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ReviewItem, ReviewKind } from '../types'

const PANE = 'review-gallery'
const TITLE = 'Review gallery'
const MAX_ITEMS = 100
// Sharpest first: each try is (max width px, WebP quality); the first whose
// base64 fits an Svg is kept, so the pane never stretches a small preview.
const TRIES: [number, number][] = [[1600, 82], [1400, 72], [1100, 68], [900, 62], [700, 55]]
const PNG_WIDTH = 720
// An Svg's source is held to 131,072 characters; leave room for the wrapper.
const MAX_SVG_CHARS = 120_000

// Change the tag when ReviewItem's fields change: it declines what an earlier
// version stored, which outlives a reload.
const items = atom({ plugin: 'review-gallery', key: 'items' } as const, [], {
  shape: 'items-2',
})

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'svg'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v'])

const extOf = (path: string) => (path.split('.').pop() ?? '').toLowerCase()
const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path
const kindOf = (path: string): ReviewKind => {
  const ext = extOf(path)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return 'file'
}
const isAbsolute = (path: string) => /^([a-zA-Z]:[\\/]|[\\/])/.test(path)
const join = (dir: string, file: string) =>
  `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${file}`
const timeOf = (at: number) => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The command that opens a file, or shows it selected in its folder. On
 * Windows the folder view goes through scripts/reveal.ps1, which starts Explorer
 * through WMI with a raw command line (no quoting trouble, not a child process).
 */
function openCommand(path: string, inFolder: boolean, isWindows: boolean, root: string): string[] {
  if (isWindows) {
    const win = path.replace(/\//g, '\\')
    return inFolder
      ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', join(root, 'scripts\\reveal.ps1'), win]
      : ['explorer.exe', win]
  }
  return inFolder ? ['xdg-open', path.replace(/[\\/][^\\/]*$/, '')] : ['xdg-open', path]
}

/** The preview as an SVG image, for desktop, the editor and the phone. */
function svgOf(item: ReviewItem): string | undefined {
  if (item.svg) return item.svg
  if (!item.thumb || !item.w || !item.h) return undefined
  const { w, h } = item
  const play =
    item.kind === 'video'
      ? `<circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 7}" fill="rgba(0,0,0,0.55)"/>` +
        `<polygon points="${w / 2 - h / 20},${h / 2 - h / 14} ${w / 2 - h / 20},${h / 2 + h / 14} ${w / 2 + h / 12},${h / 2}" fill="#fff"/>`
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image width="${w}" height="${h}" href="data:${item.mime ?? 'image/jpeg'};base64,${item.thumb}"/>${play}</svg>`
  )
}

let sessionCwd = ''
let isWindows = true

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionCwd = e.cwd
    isWindows = (await $.env.get('OS')) === 'Windows_NT'
    await $.command.register({
      name: 'review-gallery',
      description: 'Show every image, video and visual sent to you in this session',
    })
    const list = await read($, items)
    if (list.length > 0 && e.surface !== null) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'review-gallery' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    const n = (await read($, items)).length

    return { text: `Review gallery opened (${n} item${n === 1 ? '' : 's'}).` }
  })

  // Every file Claude hands over with SendUserFile lands in the gallery.
  on('tool.call', { tool: 'SendUserFile' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const attachments = (ran.result as { attachments?: { path: string }[] } | undefined)
      ?.attachments
    const paths = (attachments?.map(a => a.path) ?? e.files).map(p =>
      isAbsolute(p) || !sessionCwd ? p : join(sessionCwd, p),
    )
    const at = Date.now()
    const fresh: ReviewItem[] = paths.map((path, i) => ({
      id: `${e.tool_use_id}-${i}`,
      path,
      name: nameOf(path),
      kind: kindOf(path),
      caption: e.caption,
      at,
    }))
    if (fresh.length === 0) return ran

    await update($, items, list => [...list, ...fresh].slice(-MAX_ITEMS))
    void $.ui.open({ id: PANE, title: TITLE })

    const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    const dir = join(tmp, 'claude-review-gallery')

    const preview = async (item: ReviewItem): Promise<ReviewItem> => {
      try {
        if (!(await $.fs.exists(item.path))) return { ...item, note: 'file not found' }
        if (extOf(item.path) === 'svg') {
          const text = await $.fs.read(item.path)
          if (text.length <= MAX_SVG_CHARS && text.includes('<svg')) return { ...item, svg: text }
        }
        if (item.kind === 'file') return item

        const base = join(dir, item.id.replace(/[^\w.-]/g, '_'))
        await $.fs.write(`${base}.keep`, '') // makes the folder
        const frame = async (out: string, width: number, extra: string[], seek: boolean) =>
          $.process.run(
            ['ffmpeg', '-y', '-loglevel', 'error', ...(seek ? ['-ss', '1'] : []), '-i', item.path,
              '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, ...extra, out],
            { timeoutMs: 30_000 },
          )
        // A video's frame from 1 s in, else its first; an image's only frame.
        let seek = item.kind === 'video'
        let thumb: string | undefined
        for (const [width, quality] of TRIES) {
          const webp = ['-c:v', 'libwebp', '-quality', String(quality)]
          let shot = await frame(`${base}.webp`, width, webp, seek)
          if (shot.exitCode !== 0 && seek) {
            seek = false
            shot = await frame(`${base}.webp`, width, webp, false)
          }
          if (shot.exitCode !== 0) return { ...item, note: 'no preview (ffmpeg failed)' }
          const { base64 } = await $.fs.read(`${base}.webp`, { as: 'bytes' })
          if (base64.length <= MAX_SVG_CHARS) {
            thumb = base64
            break
          }
        }
        await frame(`${base}.png`, PNG_WIDTH, [], seek)

        const probe = await $.process.run(
          ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
            'stream=width,height', '-of', 'csv=p=0', `${base}.webp`],
          { timeoutMs: 15_000 },
        )
        const [w, h] = probe.stdout.trim().split(',').map(Number)
        if (!thumb) return { ...item, thumbPng: `${base}.png`, w, h, note: 'preview too large' }

        return { ...item, thumb, mime: 'image/webp', thumbPng: `${base}.png`, w, h }
      } catch (err) {
        return { ...item, note: `no preview (${String(err).slice(0, 80)})` }
      }
    }

    const done = await Promise.all(fresh.map(preview))
    await update($, items, list => list.map(one => done.find(d => d.id === one.id) ?? one))

    return ran
  }).catch(($, e, next) => next(e)) // a gallery failure never blocks a file reaching you

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = [...(await read($, items))].reverse()
    const count = list.length
    const open = async (path: string, inFolder: boolean) => {
      const argv = openCommand(path, inFolder, isWindows, $.plugin.root)
      try {
        const ran = await $.process.run(argv, { timeoutMs: 20_000 })
        // explorer.exe exits 1 even when it worked; the reveal script exits 0.
        if (inFolder && ran.exitCode !== 0) {
          $.ui.toast(`Show in folder failed (exit ${ran.exitCode}): ${(ran.stderr || ran.stdout).trim().slice(0, 300)}`)
        }
      } catch (err) {
        $.ui.toast(`${inFolder ? 'Show in folder' : 'Open'} failed: ${String(err).slice(0, 300)}`)
      }
    }
    const clear = () => update($, items, () => [])
    const heading =
      count === 0
        ? 'Nothing sent for review yet. Images, videos and other files Claude sends you show up here.'
        : `${count} item${count === 1 ? '' : 's'} sent for review, newest first`

    if (e.surface === 'terminal') {
      const { Box, Text, Button, Image } = $.ui.resolve(e)
      const imgCols = Math.max(10, Math.min(e.props.bodyColumns - 4, 60))

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{heading}</Text>
            {count > 0 && <Button key="clear" label="Clear" onPress={clear} />}
          </Box>
          {list.map(item => (
            <Box key={item.id} flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
              <Text bold wrap="truncate-middle">{item.name}</Text>
              <Text dimColor>
                {item.kind} · {timeOf(item.at)}{item.note ? ` · ${item.note}` : ''}
              </Text>
              {item.caption && <Text>{item.caption}</Text>}
              {item.thumbPng && (
                <Image
                  source={{ file: item.thumbPng, format: 'png' }}
                  columns={imgCols}
                  rows={item.w && item.h
                    ? Math.max(3, Math.min(30, Math.round((imgCols * item.h) / item.w / 2)))
                    : 8}
                  alt={`${item.kind}: ${item.name}`}
                />
              )}
              <Box flexDirection="row" gap={1}>
                <Button key={`open:${item.id}`} label="Open" onPress={() => open(item.path, false)} />
                <Button key={`folder:${item.id}`} label="Show in folder" onPress={() => open(item.path, true)} />
              </Box>
            </Box>
          ))}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{heading}</Text>
          {count > 0 && <Button key="clear" label="Clear" onPress={clear} />}
        </Box>
        {list.map(item => {
          const source = svgOf(item)
          return (
            <Box key={item.id} flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
              <Text bold wrap="truncate-middle">{item.name}</Text>
              <Text dimColor>
                {item.kind} · {timeOf(item.at)}{item.note ? ` · ${item.note}` : ''}
              </Text>
              {item.caption && <Text>{item.caption}</Text>}
              {source && <Svg source={source} alt={`${item.kind}: ${item.name}`} />}
              <Box flexDirection="row" gap={1}>
                <Button key={`open:${item.id}`} label="Open" onPress={() => open(item.path, false)} />
                <Button key={`folder:${item.id}`} label="Show in folder" onPress={() => open(item.path, true)} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
