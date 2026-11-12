// docs/05 §3：白名单 Markdown 渲染器的 XSS 防线 + 摘要行为。
// 所有样例均为明显伪造值，不含任何真实凭据。
import { describe, it, expect } from 'vitest'
import { renderMarkdown, markdownSummary } from '@/lib/markdown'

describe('renderMarkdown — 原始 HTML / 脚本被转义', () => {
  it('script 标签被转义，不产生可执行 <script', () => {
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).toContain('&lt;script')
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toContain('onerror')
  })

  it('img onerror 之类的属性注入同样被转义', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).toContain('&lt;img')
    expect(out).not.toContain('<img')
  })

  it('带事件的 svg 标签不进入输出', () => {
    const out = renderMarkdown('<svg onload="alert(1)"></svg>')
    expect(out).not.toMatch(/<svg/i)
    expect(out).toContain('&lt;svg')
  })
})

describe('renderMarkdown — 链接白名单（只放行 http/https）', () => {
  it('javascript: 链接不生成 <a>', () => {
    const out = renderMarkdown('[x](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
    expect(out).not.toContain('<a ')
  })

  it('data: / vbscript: 链接同样被拒绝', () => {
    for (const src of ['[x](data:text/html;base64,PHN2Zz4=)', '[x](vbscript:msgbox(1))']) {
      const out = renderMarkdown(src)
      expect(out).not.toContain('<a ')
    }
  })

  it('http/https 链接生成带 noopener noreferrer 的 <a>', () => {
    const out = renderMarkdown('[fake site](https://example.invalid/path)')
    expect(out).toContain('<a href="https://example.invalid/path"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('>fake site</a>')
  })

  it('http 链接也放行', () => {
    const out = renderMarkdown('[insecure](http://example.invalid)')
    expect(out).toContain('<a href="http://example.invalid"')
  })
})

describe('renderMarkdown — 正常语法', () => {
  it('一级标题', () => {
    const out = renderMarkdown('# Fake Notes')
    expect(out).toMatch(/^<h1 class="[^"]*">Fake Notes<\/h1>$/)
  })

  it('三级标题', () => {
    const out = renderMarkdown('### Sub')
    expect(out).toMatch(/^<h3 class="[^"]*">Sub<\/h3>$/)
  })

  it('无序列表生成 ul/li', () => {
    const out = renderMarkdown('- first\n- second')
    expect(out).toContain('<ul')
    expect(out).toContain('<li>first</li>')
    expect(out).toContain('<li>second</li>')
    expect(out).toContain('</ul>')
  })

  it('有序列表按现状渲染为段落（不生成 ol）', () => {
    const out = renderMarkdown('1. first\n2. second')
    expect(out).not.toContain('<ol')
    expect(out).toContain('<p class="my-1">1. first</p>')
    expect(out).toContain('<p class="my-1">2. second</p>')
  })

  it('引用生成 blockquote 并去掉前缀', () => {
    const out = renderMarkdown('> quoted text')
    expect(out).toContain('<blockquote')
    expect(out).toContain('>quoted text</blockquote>')
    expect(out).not.toContain('&gt; quoted')
  })

  it('围栏代码块生成 pre/code，内容保持原样并转义', () => {
    const out = renderMarkdown('```\n<b>not html</b>\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('<code>&lt;b&gt;not html&lt;/b&gt;</code>')
    expect(out).not.toContain('<b>not html</b>')
  })

  it('行内 code 生成 <code>', () => {
    const out = renderMarkdown('see `fake-token` here')
    expect(out).toContain('<code class="rounded bg-muted px-1 py-0.5">fake-token</code>')
  })

  it('粗体与斜体', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>')
    expect(renderMarkdown('*em*')).toContain('<em>em</em>')
  })

  it('普通文本渲染为段落', () => {
    expect(renderMarkdown('plain sentence')).toBe('<p class="my-1">plain sentence</p>')
  })

  it('空行不产出标签', () => {
    expect(renderMarkdown('a\n\nb')).toBe('<p class="my-1">a</p>\n<p class="my-1">b</p>')
  })

  it('列表被非列表行终止', () => {
    const out = renderMarkdown('- one\nafter')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('</ul>')
    expect(out).toContain('<p class="my-1">after</p>')
  })

  it('空输入返回空串', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('markdownSummary', () => {
  it('去掉标记并压缩空白', () => {
    expect(markdownSummary('# **Fake**  _notes_\n\n- item   one')).toBe('Fake notes item one')
  })

  it('链接保留文字去掉地址', () => {
    expect(markdownSummary('visit [fake site](https://example.invalid) now')).toBe(
      'visit fake site now',
    )
  })

  it('代码块整体丢弃，行内代码保留文字', () => {
    expect(markdownSummary('a ```\nignored\n``` b `keep`')).toBe('a b keep')
  })

  it('未超限时原长度返回，不加省略号', () => {
    expect(markdownSummary('short', 160)).toBe('short')
  })

  it('超长时截断并追加省略号', () => {
    const long = 'f'.repeat(200)
    const out = markdownSummary(long, 10)
    expect(out).toBe(`${'f'.repeat(10)}…`)
    expect(out.length).toBe(11)
  })

  it('默认上限 160', () => {
    expect(markdownSummary('x'.repeat(300)).length).toBe(161)
  })
})
