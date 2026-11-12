function quoteArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

export function createElevatedRestartCommand(
  executable: string,
  args: string[],
  parentPid: number
): string {
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) throw new Error('Invalid parent PID')
  const escapedPath = executable.replace(/'/g, "''")
  const argumentList = args.map(quoteArgument).join(' ').replace(/'/g, "''")
  const launch = `Wait-Process -Id ${parentPid} -Timeout 60 -ErrorAction SilentlyContinue; if (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { exit 1 }; Start-Process -FilePath '${escapedPath}'${args.length ? ` -ArgumentList '${argumentList}'` : ''} -WindowStyle Hidden`
  const encoded = Buffer.from(launch, 'utf16le').toString('base64')
  return `$ErrorActionPreference = 'Stop'; Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-NonInteractive', '-EncodedCommand', '${encoded}' -Verb RunAs -WindowStyle Hidden -PassThru | Out-Null`
}
