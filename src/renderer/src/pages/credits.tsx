import { Button } from '@heroui/react'
import { useNavigate } from 'react-router-dom'
import BasePage from '@renderer/components/base/base-page'

const projects = [
  [
    'Clash Party',
    '客户端基础、配置管理与系统集成',
    'GPL-3.0',
    'https://github.com/mihomo-party-org/clash-party'
  ],
  ['Mihomo', '连接协议、DNS、路由与 TUN 内核', 'GPL-3.0', 'https://github.com/MetaCubeX/mihomo'],
  ['Electron', '桌面运行环境', 'MIT', 'https://github.com/electron/electron'],
  ['React', '界面组件与状态管理', 'MIT', 'https://github.com/facebook/react'],
  ['HeroUI', '基础交互组件', 'MIT', 'https://github.com/heroui-inc/heroui'],
  ['Tailwind CSS', '界面样式工具', 'MIT', 'https://github.com/tailwindlabs/tailwindcss'],
  ['Sub-Store', '订阅加工与转换服务', 'MIT', 'https://github.com/sub-store-org/Sub-Store'],
  ['Monaco Editor', '配置与脚本编辑器', 'MIT', 'https://github.com/microsoft/monaco-editor'],
  ['Lucide', '界面图标', 'ISC', 'https://github.com/lucide-icons/lucide']
] as const

export default function Credits(): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <BasePage
      title="鸣谢与开源许可"
      header={
        <Button
          className="app-nodrag"
          size="sm"
          variant="light"
          onPress={() => navigate('/settings')}
        >
          返回设置
        </Button>
      }
    >
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-sm leading-7 text-default-500 mb-8">
          Navio
          建立在开源社区的工作之上。感谢这些项目的开发者与贡献者。以下展示主要直接使用的项目；发布包中的许可文件保留各依赖的完整法律声明。
        </p>
        <div className="divide-y divide-default-200">
          {projects.map(([name, purpose, license, url]) => (
            <a
              className="flex justify-between items-center gap-5 py-5 hover:text-primary"
              href={url}
              target="_blank"
              rel="noreferrer"
              key={name}
            >
              <div>
                <h2 className="font-semibold">{name}</h2>
                <p className="text-xs mt-2 text-default-500">{purpose}</p>
              </div>
              <span className="text-xs text-default-500">{license} ↗</span>
            </a>
          ))}
        </div>
        <p className="text-xs leading-6 mt-8 text-default-500">
          Navio
          修改版遵循所使用上游的许可证要求。源码与对应版本的发布资料一同提供。第三方项目名称及标识归各权利人所有。
        </p>
        <Button
          variant="flat"
          className="mt-4"
          onPress={() => window.open('https://www.gnu.org/licenses/gpl-3.0.html')}
        >
          阅读 GPL-3.0
        </Button>
      </div>
    </BasePage>
  )
}
