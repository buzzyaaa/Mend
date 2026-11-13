import { expect, open, test } from 'nsh/test'

test('sets up a vault, creates an entry, and locks', async () => {
  const app = await open('./App.tsx')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.type('label:Confirm master password', 'test-password-1234')
  await app.press('Create and enter')
  await app.waitFor('text:Passwords')

  await app.press('id:add-entry')
  await app.waitFor('text:New entry')
  await app.type('label:Title', 'GitHub')
  await app.type('label:Username', 'octocat')
  await app.type('label:Password', 's3cret')
  await app.press('text:Save')
  await app.waitFor('text:octocat')

  await app.press('label:Settings')
  await app.waitFor('text:Appearance & behavior')
  await app.press('id:settings-close')
  await app.press('label:Presets')
  await app.waitFor('text:Presets')
  await app.press('id:presets-close')

  await app.press('label:Lock')
  await app.waitFor('label:Master password')
  await app.type('label:Master password', 'test-password-1234')
  await app.press('text:Unlock')
  await app.waitFor('text:Passwords')
  expect(app.texts()).toContain('GitHub')
})
