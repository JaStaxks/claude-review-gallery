import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'review-gallery',
  component: 'Pane',
  requestId: 'review-gallery',
  props: {
    title: 'Review gallery',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a file sent for review is listed, newest first, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'review-gallery' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => ({
    result: { attachments: (e as { files: string[] }).files.map(path => ({ path, size: 1, isImage: true })) },
  }))

  await $.session.start({ cwd: 'E:\\proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'SendUserFile', files: ['E:\\proj\\shot-a.png'], status: 'normal' })
  await $.tool.call({
    tool: 'SendUserFile',
    files: ['clip.mp4'],
    caption: 'trailer take 9',
    status: 'normal',
  })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /2 items/ }))?.text).toContain('newest first')
    expect(await ui.find({ type: 'Text', text: /^clip\.mp4$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /trailer take 9/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^video/ }))?.text).toContain('file not found')
    expect(await ui.find({ type: 'Text', text: /^shot-a\.png$/ })).toBeDefined()
    await ui.unmount()
  }

  // Clear empties the list.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'clear' })
  expect((await ui.find({ type: 'Text', text: /Nothing sent/ }))).toBeDefined()
  await ui.unmount()
})

test('a list an earlier version stored is declined', async ($, on) => {
  on('state.get', () => ({ value: { value: [{ name: 'old' }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Nothing sent/ })).toBeDefined()
  await ui.unmount()
})
