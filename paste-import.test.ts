import { expect, test } from 'nsh/test'

import { parsePastedEntries, toEntryInput } from './lib/paste-import'

test('parses Chinese key-value blocks with punctuation in passwords', () => {
  const result = parsePastedEntries(`标题：GitHub
网址：github.com
账号：alice
密码：p@ss:word!
邮箱：alice@example.com
备注：工作账号

---

标题: Gmail
账号: alice
密码: another-pass`)

  expect(result.format).toBe('keyvalue')
  expect(result.entries.length).toBe(2)
  expect(result.entries[0].title).toBe('GitHub')
  expect(result.entries[0].url).toBe('https://github.com')
  expect(result.entries[0].username).toBe('alice')
  expect(result.entries[0].password).toBe('p@ss:word!')
  expect(result.entries[0].email).toBe('alice@example.com')
  expect(result.entries[0].notes).toBe('工作账号')
  expect(result.entries[1].title).toBe('Gmail')
  expect(result.entries[1].password).toBe('another-pass')
})

test('splits consecutive key-value blocks without blank lines', () => {
  const result = parsePastedEntries(`标题: A
账号: a
密码: pa
标题: B
账号: b
密码: pb`)
  expect(result.format).toBe('keyvalue')
  expect(result.entries.length).toBe(2)
  expect(result.entries[0].title).toBe('A')
  expect(result.entries[0].password).toBe('pa')
  expect(result.entries[1].title).toBe('B')
  expect(result.entries[1].password).toBe('pb')
})

test('parses CSV with quoted commas and English headers', () => {
  const result = parsePastedEntries(`title,url,username,password,notes
GitHub,https://github.com,alice,"a,b!c",work account
Gmail,mail.google.com,alice@gmail.com,second,"personal, backup"`)

  expect(result.format).toBe('csv')
  expect(result.entries.length).toBe(2)
  expect(result.entries[0].password).toBe('a,b!c')
  expect(result.entries[0].notes).toBe('work account')
  expect(result.entries[1].url).toBe('https://mail.google.com')
  expect(result.entries[1].password).toBe('second')
  expect(result.entries[1].notes).toBe('personal, backup')
})

test('parses Markdown tables', () => {
  const result = parsePastedEntries(`| 网站 | 账号 | 密码 | 备注 |
| --- | --- | --- | --- |
| 京东 | jd_user | jd-pass | 购物 |
| 微博 | weibo_user | wb-pass | 社交 |`)

  expect(result.format).toBe('table')
  expect(result.entries.length).toBe(2)
  expect(result.entries[0].title).toBe('京东')
  expect(result.entries[0].username).toBe('jd_user')
  expect(result.entries[0].password).toBe('jd-pass')
  expect(result.entries[0].notes).toBe('购物')
  expect(result.entries[1].title).toBe('微博')
})

test('assigns headerless pipe rows by value shape', () => {
  const result = parsePastedEntries(`GitHub | https://github.com | alice | s3cr3t | 工作
银行 | 13800138000 | bankuser | bank-pass`)

  expect(result.format).toBe('delimited')
  expect(result.entries.length).toBe(2)
  expect(result.entries[0].title).toBe('GitHub')
  expect(result.entries[0].url).toBe('https://github.com')
  expect(result.entries[0].username).toBe('alice')
  expect(result.entries[0].password).toBe('s3cr3t')
  expect(result.entries[0].notes).toBe('工作')
  expect(result.entries[1].title).toBe('银行')
  expect(result.entries[1].phone).toBe('13800138000')
  expect(result.entries[1].username).toBe('bankuser')
  expect(result.entries[1].password).toBe('bank-pass')
})

test('falls back to one title per line and tolerates empty input', () => {
  const lines = parsePastedEntries('GitHub\nGmail')
  expect(lines.format).toBe('lines')
  expect(lines.entries.length).toBe(2)
  expect(lines.entries[0].title).toBe('GitHub')

  const empty = parsePastedEntries('  \n\n')
  expect(empty.entries.length).toBe(0)
  expect(empty.skipped).toBe(0)
})

test('infers title from url and drops undefined tags on conversion', () => {
  const result = parsePastedEntries('网址: www.example.com\n密码: abc\n标签: 工作,未定义')
  expect(result.entries.length).toBe(1)
  expect(result.entries[0].title).toBe('example.com')

  const input = toEntryInput(result.entries[0], 'cat-1', ['工作'])
  expect(input.title).toBe('example.com')
  expect(input.url).toBe('https://www.example.com')
  expect(input.categoryId).toBe('cat-1')
  expect(input.tags.length).toBe(1)
  expect(input.tags[0]).toBe('工作')
})
