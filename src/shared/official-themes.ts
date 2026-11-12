import type { DexTheme } from './dex-theme'
export type OfficialThemeCategory =
  'material' | 'dynamic' | 'character' | 'season' | 'type' | 'collab'
export interface OfficialThemeSettings {
  appearance: 'system' | 'light' | 'dark'
  intensity: number
  background: boolean
  character: boolean
  feedback: boolean
  playback: 'auto' | 'always' | 'paused'
}
export interface OfficialThemePackage {
  schema: 1
  scene: string
  revision: number
  variants: { dark: DexTheme; light: DexTheme }
}
export interface OfficialThemeDefinition {
  id: string
  scene: string
  name: string
  description: string
  summary: string
  category: OfficialThemeCategory
  dynamic: boolean
  character: boolean
  builtIn: boolean
  revision: number
  sha256: string
  filename: string
  preview: { light: string[]; dark: string[] }
  package?: OfficialThemePackage
}
export interface OfficialThemeEntry extends OfficialThemeDefinition {
  installed: boolean
  favorite: boolean
  settings: OfficialThemeSettings
  cacheError?: string
}
export interface OfficialThemeCatalog {
  themes: OfficialThemeEntry[]
  activeId: string
  trial: ThemeTrialState | null
}
export interface ThemeTrialState {
  id: string
  name: string
  official: boolean
}
export const OFFICIAL_THEME_CATEGORIES: [OfficialThemeCategory, string][] = [
  ['material', '材质静态'],
  ['dynamic', '动态'],
  ['character', '角色'],
  ['season', '节日'],
  ['type', '数字排印'],
  ['collab', '联名']
]
export const OFFICIAL_THEME_RELEASE =
  'https://github.com/poniard-li/Navio/releases/download/v1.0.0-beta.7/'
export const OFFICIAL_THEMES: OfficialThemeDefinition[] = [
  {
    id: 'navio-liquid',
    scene: 'liquid',
    name: '清透玻璃',
    description: '半透明侧栏、细亮边缘和蓝灰色面板，窗口各层保持清晰。',
    summary: '通透材质 · 柔和蓝灰',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: '12e0fce8438dd3e507bb043ab4b8a828a5dfc9428179a75fa215845f61f84a1b',
    filename: 'Navio-Theme-liquid-1.json',
    preview: {
      light: [
        '#e6edf0',
        '#f5f8f9',
        '#dce6ea',
        '#b6cad3',
        '#25353c',
        '#56707b',
        '#2e6b85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#172226',
        '#213036',
        '#2a3e46',
        '#40555e',
        '#ecf1f4',
        '#a5bcc5',
        '#90c7df',
        '#1a2b32',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'liquid',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-liquid',
          name: '清透玻璃',
          author: 'D.E.X Studio',
          description: '半透明侧栏、细亮边缘和蓝灰色面板，窗口各层保持清晰。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#172226',
            surface: '#213036',
            surfaceRaised: '#2a3e46',
            border: '#40555e',
            text: '#ecf1f4',
            muted: '#a5bcc5',
            accent: '#90c7df',
            accentText: '#1a2b32',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#172226']
          }
        },
        light: {
          id: 'navio-liquid',
          name: '清透玻璃',
          author: 'D.E.X Studio',
          description: '半透明侧栏、细亮边缘和蓝灰色面板，窗口各层保持清晰。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#e6edf0',
            surface: '#f5f8f9',
            surfaceRaised: '#dce6ea',
            border: '#b6cad3',
            text: '#25353c',
            muted: '#56707b',
            accent: '#2e6b85',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#e6edf0']
          }
        }
      }
    }
  },
  {
    id: 'navio-ink',
    scene: 'ink',
    name: '石墨',
    description: '实色面板与更明确的分隔线。配色克制，适合长时间查看节点、规则和日志。',
    summary: '实色表面 · 清晰分隔',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: '386f5b55a6b4c418928b2889e28c3e363cffcd609c2c6c27114fccbba6e21765',
    filename: 'Navio-Theme-ink-1.json',
    preview: {
      light: [
        '#e9eaec',
        '#f7f7f8',
        '#e0e3e5',
        '#bfc4ca',
        '#25303c',
        '#56677b',
        '#2e5685',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#1c1e21',
        '#272b2f',
        '#33383d',
        '#404e5e',
        '#eceff4',
        '#a5b4c5',
        '#90b5df',
        '#1a2532',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'ink',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-ink',
          name: '石墨',
          author: 'D.E.X Studio',
          description: '实色面板与更明确的分隔线。配色克制，适合长时间查看节点、规则和日志。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#1c1e21',
            surface: '#272b2f',
            surfaceRaised: '#33383d',
            border: '#404e5e',
            text: '#eceff4',
            muted: '#a5b4c5',
            accent: '#90b5df',
            accentText: '#1a2532',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#1c1e21']
          }
        },
        light: {
          id: 'navio-ink',
          name: '石墨',
          author: 'D.E.X Studio',
          description: '实色面板与更明确的分隔线。配色克制，适合长时间查看节点、规则和日志。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#e9eaec',
            surface: '#f7f7f8',
            surfaceRaised: '#e0e3e5',
            border: '#bfc4ca',
            text: '#25303c',
            muted: '#56677b',
            accent: '#2e5685',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#e9eaec']
          }
        }
      }
    }
  },
  {
    id: 'navio-paper',
    scene: 'paper',
    name: '暖纸',
    description: '暖灰背景、细腻纸纹和低反光表面。标题、表格与控件使用同一套暖色层次。',
    summary: '温暖灰白 · 轻微纸纹',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: '1b500522c654e1eb4a49302104b7bafe4f6c6933e70d87496ea3dbd5d9401c72',
    filename: 'Navio-Theme-paper-1.json',
    preview: {
      light: [
        '#ecebe9',
        '#f8f8f7',
        '#e5e4e0',
        '#cac6bf',
        '#3c3525',
        '#7b6f56',
        '#85692e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#21201c',
        '#2f2d27',
        '#3d3a33',
        '#5e5540',
        '#f4f1ec',
        '#c5bba5',
        '#dfc690',
        '#322b1a',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'paper',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-paper',
          name: '暖纸',
          author: 'D.E.X Studio',
          description: '暖灰背景、细腻纸纹和低反光表面。标题、表格与控件使用同一套暖色层次。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#21201c',
            surface: '#2f2d27',
            surfaceRaised: '#3d3a33',
            border: '#5e5540',
            text: '#f4f1ec',
            muted: '#c5bba5',
            accent: '#dfc690',
            accentText: '#322b1a',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#21201c']
          }
        },
        light: {
          id: 'navio-paper',
          name: '暖纸',
          author: 'D.E.X Studio',
          description: '暖灰背景、细腻纸纹和低反光表面。标题、表格与控件使用同一套暖色层次。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#ecebe9',
            surface: '#f8f8f7',
            surfaceRaised: '#e5e4e0',
            border: '#cac6bf',
            text: '#3c3525',
            muted: '#7b6f56',
            accent: '#85692e',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#ecebe9']
          }
        }
      }
    }
  },
  {
    id: 'navio-aurora',
    scene: 'aurora',
    name: '流动极光',
    description: '整幅背景在窗口底层缓慢流动，颜色透过侧栏和面板。功能位置保持一致。',
    summary: '流动背景 · 透光面板',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '215e89e65c68094fa6103e51a20764267f015a06ca36ce630bb3922e6d3388fb',
    filename: 'Navio-Theme-aurora-1.json',
    preview: {
      light: [
        '#e6f0f0',
        '#f5f9f9',
        '#dceaea',
        '#b6d3d3',
        '#253c3c',
        '#567b7b',
        '#2e8585',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#172626',
        '#213636',
        '#2a4646',
        '#405e5e',
        '#ecf4f4',
        '#a5c5c5',
        '#90dfdf',
        '#1a3232',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-cat',
    scene: 'cat',
    name: '午后猫舍',
    description:
      '阳光穿过猫舍的窗格，窗台和柔软布料构成整幅背景。猫咪在现有卡片边缘活动，连接、节点切换和测速时会回应。',
    summary: '暖光窗影 · 猫咪陪伴',
    category: 'character',
    dynamic: true,
    character: true,
    builtIn: false,
    revision: 1,
    sha256: '37ca66fb531406f8046cf3263d2e25807627f3bf92a861c95d807b039e58bc78',
    filename: 'Navio-Theme-cat-1.json',
    preview: {
      light: [
        '#f0ebe6',
        '#f9f7f5',
        '#eae3dc',
        '#d3c5b6',
        '#3c3125',
        '#7b6956',
        '#855b2e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#261f17',
        '#362c21',
        '#46392a',
        '#5e5040',
        '#f4f0ec',
        '#c5b6a5',
        '#dfb990',
        '#32271a',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-winter',
    scene: 'winter',
    name: '冬日初雪',
    description:
      '冰蓝色磨砂表面搭配窗边积雪与稀疏雪花。雪花位于窗口底层，列表、输入框和文字保持清晰。',
    summary: '冰蓝磨砂 · 缓慢飘雪',
    category: 'season',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: 'c106846408bea3c4b5d60aae3bfffe8e484224bb67c7d4d11e961f9ed33b5cc9',
    filename: 'Navio-Theme-winter-1.json',
    preview: {
      light: [
        '#e6ecf0',
        '#f5f8f9',
        '#dce4ea',
        '#b6c7d3',
        '#25333c',
        '#566c7b',
        '#2e6285',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#172026',
        '#212e36',
        '#2a3b46',
        '#40525e',
        '#ecf0f4',
        '#a5b8c5',
        '#90bfdf',
        '#1a2932',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-festival',
    scene: 'festival',
    name: '新岁',
    description: '朱砂与暖金贯穿侧栏、选中状态及按钮。灯影在窗口边缘轻轻晃动，纸纹融入表面。',
    summary: '朱砂暖金 · 纸纹与灯影',
    category: 'season',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '2de1f96c8d29f96dab3f4cfd5e43d05940b8b2b8e6eed9d6ff90c84ab34e8dc8',
    filename: 'Navio-Theme-festival-1.json',
    preview: {
      light: [
        '#f0e8e6',
        '#f9f6f5',
        '#eadfdc',
        '#d3bcb6',
        '#3c2a25',
        '#7b5d56',
        '#853f2e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#261a17',
        '#362521',
        '#46302a',
        '#5e4640',
        '#f4edec',
        '#c5aba5',
        '#dfa090',
        '#321f1a',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-precision',
    scene: 'precision',
    name: '精密刻度',
    description:
      '下载速率、连接时长、延迟与订阅余量采用等宽排印。原有流量曲线和进度使用清晰刻度，不增加额外数字面板。',
    summary: '等宽数字 · 清晰单位 · 原位刻度',
    category: 'type',
    dynamic: false,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: 'b1f484dff37967414fa00610426a09e2313cb71df8c46695e593b0e6d3bb5055',
    filename: 'Navio-Theme-precision-1.json',
    preview: {
      light: [
        '#e6f0eb',
        '#f5f9f7',
        '#dceae3',
        '#b6d3c5',
        '#253c31',
        '#567b69',
        '#2e855b',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#17261f',
        '#21362c',
        '#2a4639',
        '#405e50',
        '#ecf4f0',
        '#a5c5b6',
        '#90dfb9',
        '#1a3227',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-mystery',
    scene: 'mystery',
    name: 'Navio × D.E.X Mystery',
    description:
      'D.E.X 自有产品联名。包装纸、烫金丝带、礼盒和飘动彩纸覆盖整个窗口，连接时礼盒展开，操作时带来轻快反馈。',
    summary: '自有产品联名 · 紫罗兰包装纸',
    category: 'collab',
    dynamic: true,
    character: true,
    builtIn: false,
    revision: 1,
    sha256: 'cdb15fab234b1e65e611bbcbfa220e5aa15478640879da21d63a6375c93eb740',
    filename: 'Navio-Theme-mystery-1.json',
    preview: {
      light: [
        '#ede6f0',
        '#f8f5f9',
        '#e6dcea',
        '#ccb6d3',
        '#36253c',
        '#72567b',
        '#6f2e85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#221726',
        '#312136',
        '#3f2a46',
        '#57405e',
        '#f2ecf4',
        '#bda5c5',
        '#cb90df',
        '#2c1a32',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-ceramic',
    scene: 'ceramic',
    name: '白瓷',
    description: '柔白与青瓷色层次覆盖整个窗口，纹理和阴影保持安静。',
    summary: '柔白表面 · 青瓷细节',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: 'e75e62ba9097963801c3196b0446e3c7217b08a3c6a5d777085dbc001a35982c',
    filename: 'Navio-Theme-ceramic-1.json',
    preview: {
      light: [
        '#e6f0ef',
        '#f5f9f9',
        '#dceae8',
        '#b6d3d0',
        '#253c39',
        '#567b77',
        '#2e857b',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#172624',
        '#213634',
        '#2a4643',
        '#405e5b',
        '#ecf4f3',
        '#a5c5c2',
        '#90dfd6',
        '#1a3230',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'ceramic',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-ceramic',
          name: '白瓷',
          author: 'D.E.X Studio',
          description: '柔白与青瓷色层次覆盖整个窗口，纹理和阴影保持安静。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#172624',
            surface: '#213634',
            surfaceRaised: '#2a4643',
            border: '#405e5b',
            text: '#ecf4f3',
            muted: '#a5c5c2',
            accent: '#90dfd6',
            accentText: '#1a3230',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#172624']
          }
        },
        light: {
          id: 'navio-ceramic',
          name: '白瓷',
          author: 'D.E.X Studio',
          description: '柔白与青瓷色层次覆盖整个窗口，纹理和阴影保持安静。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#e6f0ef',
            surface: '#f5f9f9',
            surfaceRaised: '#dceae8',
            border: '#b6d3d0',
            text: '#253c39',
            muted: '#567b77',
            accent: '#2e857b',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#e6f0ef']
          }
        }
      }
    }
  },
  {
    id: 'navio-midnight',
    scene: 'midnight',
    name: '午夜蓝',
    description: '蓝黑色表面与冷银分隔线，让长列表和密集日志更容易阅读。',
    summary: '蓝黑层次 · 冷银细节',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: 'd4ad3e8681b1a4e79f4869867596ed845261e38ad35d3d84de044d6dfded0b40',
    filename: 'Navio-Theme-midnight-1.json',
    preview: {
      light: [
        '#e6eaf0',
        '#f5f7f9',
        '#dce2ea',
        '#b6c1d3',
        '#252e3c',
        '#56657b',
        '#2e5185',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#171d26',
        '#212936',
        '#2a3546',
        '#404c5e',
        '#eceff4',
        '#a5b2c5',
        '#90b0df',
        '#1a2432',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'midnight',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-midnight',
          name: '午夜蓝',
          author: 'D.E.X Studio',
          description: '蓝黑色表面与冷银分隔线，让长列表和密集日志更容易阅读。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#171d26',
            surface: '#212936',
            surfaceRaised: '#2a3546',
            border: '#404c5e',
            text: '#eceff4',
            muted: '#a5b2c5',
            accent: '#90b0df',
            accentText: '#1a2432',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#171d26']
          }
        },
        light: {
          id: 'navio-midnight',
          name: '午夜蓝',
          author: 'D.E.X Studio',
          description: '蓝黑色表面与冷银分隔线，让长列表和密集日志更容易阅读。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#e6eaf0',
            surface: '#f5f7f9',
            surfaceRaised: '#dce2ea',
            border: '#b6c1d3',
            text: '#252e3c',
            muted: '#56657b',
            accent: '#2e5185',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#e6eaf0']
          }
        }
      }
    }
  },
  {
    id: 'navio-linen',
    scene: 'linen',
    name: '亚麻',
    description: '细密的交织纹理铺在窗口底层，控件使用温暖的灰褐色。',
    summary: '织物纹理 · 自然暖灰',
    category: 'material',
    dynamic: false,
    character: false,
    builtIn: true,
    revision: 1,
    sha256: 'c30e18185de672157732d01a051dcd32cfaf6c660c6742beabe0d77c23cfee2a',
    filename: 'Navio-Theme-linen-1.json',
    preview: {
      light: [
        '#ecebe9',
        '#f8f8f7',
        '#e5e4e0',
        '#cac6bf',
        '#3c3325',
        '#7b6d56',
        '#85632e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#211f1c',
        '#2f2c27',
        '#3d3933',
        '#5e5340',
        '#f4f1ec',
        '#c5b9a5',
        '#dfc190',
        '#32291a',
        '#81cfac'
      ]
    },
    package: {
      schema: 1,
      scene: 'linen',
      revision: 1,
      variants: {
        dark: {
          id: 'navio-linen',
          name: '亚麻',
          author: 'D.E.X Studio',
          description: '细密的交织纹理铺在窗口底层，控件使用温暖的灰褐色。',
          appearance: 'dark',
          radius: 14,
          colors: {
            bg: '#211f1c',
            surface: '#2f2c27',
            surfaceRaised: '#3d3933',
            border: '#5e5340',
            text: '#f4f1ec',
            muted: '#c5b9a5',
            accent: '#dfc190',
            accentText: '#32291a',
            success: '#81cfac'
          },
          background: {
            type: 'solid',
            colors: ['#211f1c']
          }
        },
        light: {
          id: 'navio-linen',
          name: '亚麻',
          author: 'D.E.X Studio',
          description: '细密的交织纹理铺在窗口底层，控件使用温暖的灰褐色。',
          appearance: 'light',
          radius: 14,
          colors: {
            bg: '#ecebe9',
            surface: '#f8f8f7',
            surfaceRaised: '#e5e4e0',
            border: '#cac6bf',
            text: '#3c3325',
            muted: '#7b6d56',
            accent: '#85632e',
            accentText: '#ffffff',
            success: '#32815d'
          },
          background: {
            type: 'solid',
            colors: ['#ecebe9']
          }
        }
      }
    }
  },
  {
    id: 'navio-tide',
    scene: 'tide',
    name: '潮汐',
    description: '多层潮线缓慢推进，浅蓝色水光随之移动。整幅海面贯穿工作区。',
    summary: '潮线推进 · 深海蓝',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '6fbd1f27780355da5ea52478e00f49b82d68717458918f87b3fad388a1fab2a9',
    filename: 'Navio-Theme-tide-1.json',
    preview: {
      light: [
        '#e6ecf0',
        '#f5f8f9',
        '#dce6ea',
        '#b6cad3',
        '#25353c',
        '#566f7b',
        '#2e6985',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#172126',
        '#212f36',
        '#2a3d46',
        '#40555e',
        '#ecf1f4',
        '#a5bbc5',
        '#90c6df',
        '#1a2b32',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-orbit',
    scene: 'orbit',
    name: '月光轨道',
    description: '三道轨迹沿不同角度运行，星点持续绕行，月光映入窗口表面。',
    summary: '轨道运行 · 星尘',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '9d1eea5998199f352b46186fcf79e1389696ca7990cac0e6d5cbfece88f4a8ff',
    filename: 'Navio-Theme-orbit-1.json',
    preview: {
      light: [
        '#e6e7f0',
        '#f5f6f9',
        '#dcdeea',
        '#b6bad3',
        '#25293c',
        '#565b7b',
        '#2e3b85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#171926',
        '#212436',
        '#2a2e46',
        '#40455e',
        '#ecedf4',
        '#a5aac5',
        '#909cdf',
        '#1a1e32',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-cloud',
    scene: 'cloud',
    name: '云海',
    description: '前后两层云带以不同速度穿过窗口，天光在云间慢慢变化。',
    summary: '层云漫游 · 晨曦',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: 'f1d48cf844674081578ef0d7f7a446dcc1c8ce969b5d895378053b89f2aec1d5',
    filename: 'Navio-Theme-cloud-1.json',
    preview: {
      light: [
        '#e6eaf0',
        '#f5f7f9',
        '#dce2ea',
        '#b6c3d3',
        '#252f3c',
        '#56677b',
        '#2e5585',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#171e26',
        '#212a36',
        '#2a3746',
        '#404e5e',
        '#eceff4',
        '#a5b3c5',
        '#90b4df',
        '#1a2532',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-dunes',
    scene: 'dunes',
    name: '流沙',
    description: '三层沙丘轮廓缓慢错位，流动的明暗让起伏清晰可见。',
    summary: '移动沙脊 · 暖铜',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '92c8779b82a9661e425106785c9aae2c85ef3d343c22226429d78378daf5cad5',
    filename: 'Navio-Theme-dunes-1.json',
    preview: {
      light: [
        '#f0eae6',
        '#f9f7f5',
        '#eae3dc',
        '#d3c4b6',
        '#3c3025',
        '#7b6856',
        '#85582e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#261e17',
        '#362b21',
        '#46382a',
        '#5e4f40',
        '#f4f0ec',
        '#c5b5a5',
        '#dfb690',
        '#32261a',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-rain',
    scene: 'rain',
    name: '雨夜',
    description: '雨线持续滑过窗面，远处光晕轻轻摇动。所有文字和操作留在清晰的前景。',
    summary: '雨线滑落 · 远处灯光',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: 'cadfdd89c2152c123ebfa96c18f141c20b9cb5ef913fb158941a05d2003a8d1d',
    filename: 'Navio-Theme-rain-1.json',
    preview: {
      light: [
        '#e6e9f0',
        '#f5f7f9',
        '#dce1ea',
        '#b6bfd3',
        '#252d3c',
        '#56627b',
        '#2e4b85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#171c26',
        '#212836',
        '#2a3346',
        '#404a5e',
        '#eceef4',
        '#a5b0c5',
        '#90abdf',
        '#1a2232',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-fireflies',
    scene: 'fireflies',
    name: '萤火',
    description: '微光在草木剪影之间各自游动，窗口下缘保留安静的林地轮廓。',
    summary: '森林剪影 · 游动微光',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '4f4b1316d9e4c8eacb479b2f5358b75677626d613da2ef838a74bdea0df5fcb8',
    filename: 'Navio-Theme-fireflies-1.json',
    preview: {
      light: [
        '#e6f0eb',
        '#f5f9f7',
        '#dceae3',
        '#b6d3c5',
        '#253c31',
        '#567b69',
        '#2e855b',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#17261f',
        '#21362c',
        '#2a4639',
        '#405e50',
        '#ecf4f0',
        '#a5c5b6',
        '#90dfb9',
        '#1a3227',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-eclipse',
    scene: 'eclipse',
    name: '日食',
    description: '月影慢慢掠过日冕，光环明暗随遮挡变化，背景保持持续运动。',
    summary: '月影巡行 · 日冕',
    category: 'dynamic',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '57738810cad636411c17247ccdd42ca70966b4f1ad3c1f3bb7c8fd5f32caeb95',
    filename: 'Navio-Theme-eclipse-1.json',
    preview: {
      light: [
        '#ece6f0',
        '#f8f5f9',
        '#e4dcea',
        '#c7b6d3',
        '#33253c',
        '#6c567b',
        '#622e85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#201726',
        '#2e2136',
        '#3b2a46',
        '#52405e',
        '#f0ecf4',
        '#b8a5c5',
        '#bf90df',
        '#291a32',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-catnight',
    scene: 'catnight',
    name: '猫的夜班',
    description: '猫咪守着月光下的窗台。连接时抬头、断开时休息，鼠标和操作会引来它的注意。',
    summary: '月光窗台 · 夜班伙伴',
    category: 'character',
    dynamic: true,
    character: true,
    builtIn: false,
    revision: 1,
    sha256: 'a9b3856a0fb8520f0581eec71e42be1e1f16edc7d5dd51a79c331c9b9191b808',
    filename: 'Navio-Theme-catnight-1.json',
    preview: {
      light: [
        '#e6e8f0',
        '#f5f6f9',
        '#dcdfea',
        '#b6bdd3',
        '#252b3c',
        '#565f7b',
        '#2e4285',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#171b26',
        '#212636',
        '#2a3146',
        '#40475e',
        '#eceef4',
        '#a5acc5',
        '#90a3df',
        '#1a2032',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-fox',
    scene: 'fox',
    name: '林间来客',
    description: '小狐狸待在林地边缘，尾巴缓缓摆动。它会跟随操作转头，连接状态改变时靠近或坐下。',
    summary: '林地余晖 · 小狐狸',
    category: 'character',
    dynamic: true,
    character: true,
    builtIn: false,
    revision: 1,
    sha256: '3ab5acf9f8da66623804105728f64ccbbbf8d19fe55b27133370a986a98e82f9',
    filename: 'Navio-Theme-fox-1.json',
    preview: {
      light: [
        '#f0eae6',
        '#f9f7f5',
        '#eae2dc',
        '#d3c3b6',
        '#3c2f25',
        '#7b6756',
        '#85552e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#261e17',
        '#362a21',
        '#46372a',
        '#5e4e40',
        '#f4efec',
        '#c5b3a5',
        '#dfb490',
        '#32251a',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-blossom',
    scene: 'blossom',
    name: '春日来信',
    description: '轻薄花瓣从枝头飘落，淡粉与新绿铺进窗口和控件表面。',
    summary: '花瓣飘落 · 春日绿',
    category: 'season',
    dynamic: true,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '7d751fa818dd7f8aef27a7452a26a00d1f0b36c69d7d11f56ecf122cdda772c7',
    filename: 'Navio-Theme-blossom-1.json',
    preview: {
      light: [
        '#f0e6e9',
        '#f9f5f7',
        '#eadce1',
        '#d3b6c0',
        '#3c252d',
        '#7b5663',
        '#852e4c',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#26171c',
        '#362128',
        '#462a34',
        '#5e404b',
        '#f4ecef',
        '#c5a5b0',
        '#df90ac',
        '#321a23',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-editorial',
    scene: 'editorial',
    name: '书页',
    description: '衬线标题与正文形成明确层次，原有速率、时长和余量保持等宽排列。',
    summary: '衬线标题 · 清晰数据',
    category: 'type',
    dynamic: false,
    character: false,
    builtIn: false,
    revision: 1,
    sha256: '1dc260f3cfd1e98dba7eff69bca03cceda6fa6f995ccf127b54196b3ed285d24',
    filename: 'Navio-Theme-editorial-1.json',
    preview: {
      light: [
        '#ecebe9',
        '#f8f8f7',
        '#e5e4e0',
        '#cac6bf',
        '#3c3425',
        '#7b6f56',
        '#85682e',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#21201c',
        '#2f2d27',
        '#3d3a33',
        '#5e5440',
        '#f4f1ec',
        '#c5baa5',
        '#dfc590',
        '#322a1a',
        '#81cfac'
      ]
    }
  },
  {
    id: 'navio-mysterynight',
    scene: 'mysterynight',
    name: 'Mystery · 午夜派对',
    description:
      'D.E.X Mystery 的午夜配色。彩纸、灯带与礼盒组成整个窗口的场景，连接与操作带来短暂回应。',
    summary: '自有产品联名 · 午夜礼盒',
    category: 'collab',
    dynamic: true,
    character: true,
    builtIn: false,
    revision: 1,
    sha256: 'ac0184aaf5fe3004fc99302ed3a15884a7cec4f18260d8f303170f3e6e01cbee',
    filename: 'Navio-Theme-mysterynight-1.json',
    preview: {
      light: [
        '#ebe6f0',
        '#f8f5f9',
        '#e4dcea',
        '#c7b6d3',
        '#32253c',
        '#6c567b',
        '#612e85',
        '#ffffff',
        '#32815d'
      ],
      dark: [
        '#201726',
        '#2d2136',
        '#3a2a46',
        '#52405e',
        '#f0ecf4',
        '#b8a5c5',
        '#be90df',
        '#281a32',
        '#81cfac'
      ]
    }
  }
]
export function officialThemeDefinition(id: string): OfficialThemeDefinition | undefined {
  return OFFICIAL_THEMES.find((t) => t.id === id)
}
export function defaultOfficialSettings(): OfficialThemeSettings {
  return {
    appearance: 'system',
    intensity: 45,
    background: true,
    character: true,
    feedback: true,
    playback: 'auto'
  }
}
export function normalizeOfficialSettings(raw: unknown): OfficialThemeSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<OfficialThemeSettings>
  const d = defaultOfficialSettings()
  return {
    appearance:
      v.appearance === 'system' || v.appearance === 'dark' || v.appearance === 'light'
        ? v.appearance
        : d.appearance,
    intensity:
      typeof v.intensity === 'number' && Number.isFinite(v.intensity)
        ? Math.min(100, Math.max(0, v.intensity))
        : d.intensity,
    background: v.background !== false,
    character: v.character !== false,
    feedback: v.feedback !== false,
    playback:
      v.playback === 'auto' || v.playback === 'always' || v.playback === 'paused'
        ? v.playback
        : d.playback
  }
}
export function officialPreviewTheme(
  t: OfficialThemeDefinition,
  appearance: 'light' | 'dark'
): DexTheme {
  const keys = [
    'bg',
    'surface',
    'surfaceRaised',
    'border',
    'text',
    'muted',
    'accent',
    'accentText',
    'success'
  ] as const
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    author: 'D.E.X Studio',
    appearance,
    radius: t.scene === 'precision' ? 8 : 14,
    colors: Object.fromEntries(
      keys.map((k, i) => [k, t.preview[appearance][i]])
    ) as DexTheme['colors'],
    background: { type: 'solid', colors: [t.preview[appearance][0]] }
  }
}
