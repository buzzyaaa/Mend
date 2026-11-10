// 极简 Markdown 渲染：先整体转义 HTML，再只生成白名单标签，
// 因此原始 HTML、脚本、javascript: 链接都不会被解释（见 docs/05 §3）。

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 行内语法：`code`、**粗体**、*斜体*、[文字](http/https 链接)。 */
function renderInline(text: string): string {
  let out = escapeHtml(text)

  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5">$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')

  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => {
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary underline">${label}</a>`
  })

  return out
}

/**
 * 把 Markdown 渲染成安全 HTML 片段。
 * 支持：标题、无序/有序列表、引用、代码块、段落与空行。
 */
export function renderMarkdown(source: string): string {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []

  let inCode = false
  let codeBuffer: string[] = []
  let inList = false

  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.trim().startsWith('```')) {
      closeList()
      if (inCode) {
        html.push(`<pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuffer.push(raw)
      continue
    }

    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      const sizes: Record<number, string> = {
        1: 'text-lg font-semibold mt-4 mb-2',
        2: 'text-base font-semibold mt-4 mb-2',
        3: 'text-sm font-semibold mt-3 mb-1',
        4: 'text-sm font-semibold mt-3 mb-1',
        5: 'text-sm font-semibold mt-3 mb-1',
        6: 'text-sm font-semibold mt-3 mb-1',
      }
      html.push(`<h${level} class="${sizes[level]}">${renderInline(heading[2])}</h${level}>`)
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      if (!inList) {
        html.push('<ul class="my-2 list-disc space-y-1 pl-5">')
        inList = true
      }
      html.push(`<li>${renderInline(bullet[1])}</li>`)
      continue
    }

    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      closeList()
      html.push(`<p class="my-1">${renderInline(line)}</p>`)
      continue
    }

    if (line.startsWith('>')) {
      closeList()
      html.push(
        `<blockquote class="my-2 border-l-2 border-border pl-3 text-muted-foreground">${renderInline(
          line.replace(/^>\s?/, ''),
        )}</blockquote>`,
      )
      continue
    }

    closeList()
    html.push(`<p class="my-1">${renderInline(line)}</p>`)
  }

  if (inCode && codeBuffer.length) {
    html.push(`<pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
  }
  closeList()

  return html.join('\n')
}

/** 列表卡片用的一行摘要：去掉 Markdown 标记，压缩空白并截断。 */
export function markdownSummary(source: string, limit = 160): string {
  const plain = (source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/[*_#>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (plain.length <= limit) return plain
  return `${plain.slice(0, limit)}…`
}
