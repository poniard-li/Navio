// Navio releases must never install another product over this application.
// Core updates remain available in the dedicated Mihomo settings.
export async function checkUpdate(): Promise<IAppVersion | undefined> {
  throw new Error(
    'Navio 预览版尚未配置客户端更新源，请通过 Navio 发布包升级。内核可在内核设置中单独更新。'
  )
}

export async function downloadAndInstallUpdate(_version: string): Promise<void> {
  throw new Error('Navio 客户端更新源尚未配置，未执行任何下载或安装。')
}
