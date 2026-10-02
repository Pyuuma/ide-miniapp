function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inline(text: string): string {
  let s = escapeHtml(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:8rpx;display:block" />'
  )
  s = s.replace(/(^|[^"'])\[([^\]]+)\]\(([^)\s]+)\)/g, '$1<a href="$3">$2</a>')
  return s
}

export function renderMarkdown(md: string): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let listType: '' | 'ul' | 'ol' = ''
  let listHtml: string[] = []
  let quote: string[] = []
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join('<br/>')}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (listType) {
      html.push(`<${listType}>${listHtml.join('')}</${listType}>`)
      listType = ''
      listHtml = []
    }
  }
  const flushQuote = () => {
    if (quote.length) {
      html.push(`<blockquote>${quote.map(inline).join('<br/>')}</blockquote>`)
      quote = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (inCode) {
      if (/^```/.test(line.trim())) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []
        inCode = false
      } else {
        codeBuf.push(line)
      }
      continue
    }
    const trimmed = line.trim()
    if (/^```/.test(trimmed)) {
      flushPara()
      flushList()
      flushQuote()
      inCode = true
      codeBuf = []
      continue
    }
    if (!trimmed) {
      flushPara()
      flushList()
      flushQuote()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      flushList()
      flushQuote()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara()
      flushList()
      flushQuote()
      html.push('<hr/>')
      continue
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara()
      flushList()
      quote.push(trimmed.replace(/^>\s?/, ''))
      continue
    }
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed)
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (ul || ol) {
      flushPara()
      flushQuote()
      const type = ol ? 'ol' : 'ul'
      if (listType !== type) {
        flushList()
        listType = type
      }
      const content = ul ? ul[1] : ol ? ol[1] : ''
      listHtml.push(`<li>${inline(content)}</li>`)
      continue
    }
    flushList()
    flushQuote()
    para.push(trimmed)
  }
  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  }
  flushPara()
  flushList()
  flushQuote()
  return html.join('')
}
