import { expect, test } from 'nsh/test'

import { siteIconForUrl } from './lib/site-icons'

test('matches brand icons for URLs, bare hosts and subdomains', () => {
  expect(siteIconForUrl('https://www.bing.com/search?q=mend')?.name).toBe('Bing')
  expect(siteIconForUrl('github.com')?.name).toBe('GitHub')
  expect(siteIconForUrl('https://console.aws.amazon.com/')?.name).toBe('AWS')
  expect(siteIconForUrl('mail.google.com')?.name).toBe('Gmail')
  expect(siteIconForUrl('https://foo.github.io/page')?.name).toBe('GitHub')
})

test('falls back to null for unknown, empty or malformed websites', () => {
  expect(siteIconForUrl('not-a-real-site.invalid')).toBe(null)
  expect(siteIconForUrl('')).toBe(null)
  expect(siteIconForUrl(null)).toBe(null)
  expect(siteIconForUrl('http://')).toBe(null)
})
