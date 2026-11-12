export function redactLogText(text: string): string {
  return text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[credentials]@')
    .replace(
      /([?&](?:token|key|secret|password|passwd|auth|api[_-]?key|auth[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token)=)[^\s&#]*/gi,
      '$1[hidden]'
    )
    .replace(
      /(["']?\b(?:proxy-)?authorization["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:bearer|basic)\s+[^\s,;]+|[^\s,;]+)/gi,
      '$1[hidden]'
    )
    .replace(
      /(["']?\b(?:password|passwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&#}\]]+)/gi,
      '$1[hidden]'
    )
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
    .replace(/(?<![\w:])(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?:%[\w]+)?/gi, (value) =>
      value.includes('::') || (value.match(/:/g)?.length ?? 0) >= 7 ? '[IP]' : value
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
}
