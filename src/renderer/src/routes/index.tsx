import { lazy } from 'react'
import { Navigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { getSiderCardRoute } from '@renderer/utils/sider'
import DexThemes from '../pages/dex-themes'
import {
  Connections,
  DNS,
  Logs,
  Mihomo,
  NetworkPageComponent,
  Override,
  Profiles,
  Proxies,
  Resources,
  Rules,
  Settings,
  Sniffer,
  SubStore,
  Sysproxy,
  Simple,
  SimpleModule,
  Traffic,
  Tun
} from './route-pages'

export { useDeferredRoutePreload } from './route-pages'

const Help = lazy(() => import('../pages/help'))
const Bypass = lazy(() => import('../pages/bypass'))
const Home = lazy(() => import('../pages/home'))
const Credits = lazy(() => import('../pages/credits'))

const HomeRedirect: React.FC = () => {
  const { appConfig } = useAppConfig()

  if (!appConfig) return null
  const dest = appConfig.rememberSelectedSiderCard ? appConfig.lastSelectedSiderCard : undefined
  if (!dest) return <Navigate to="/home" replace />
  return <Navigate to={getSiderCardRoute(dest)} replace />
}

const ProfilesRoute: React.FC = () => {
  const { appConfig } = useAppConfig()
  if (!appConfig) return null
  return appConfig.operationMode === 'simple' ? <Navigate to="/simple" replace /> : <Profiles />
}

const routes = [
  { path: '/home', element: <Home /> },
  { path: '/credits', element: <Credits /> },
  {
    path: '/help',
    element: <Help />
  },
  {
    path: '/bypass',
    element: <Bypass />
  },
  {
    path: '/dex-themes',
    element: <DexThemes />
  },
  {
    path: '/network',
    element: <NetworkPageComponent />
  },
  {
    path: '/mihomo',
    element: <Mihomo />
  },
  {
    path: '/sysproxy',
    element: <Sysproxy />
  },
  {
    path: '/tun',
    element: <Tun />
  },
  {
    path: '/proxies',
    element: <Proxies />
  },
  {
    path: '/rules',
    element: <Rules />
  },
  {
    path: '/resources',
    element: <Resources />
  },
  {
    path: '/dns',
    element: <DNS />
  },
  {
    path: '/sniffer',
    element: <Sniffer />
  },
  {
    path: '/logs',
    element: <Logs />
  },
  {
    path: '/connections',
    element: <Connections />
  },
  {
    path: '/override',
    element: <Override />
  },
  {
    path: '/profiles',
    element: <ProfilesRoute />
  },
  {
    path: '/settings',
    element: <Settings />
  },
  {
    path: '/substore',
    element: <SubStore />
  },
  {
    path: '/traffic',
    element: <Traffic />
  },
  {
    path: '/simple',
    element: <Simple />
  },
  {
    path: '/simple/:module',
    element: <SimpleModule />
  },
  {
    path: '/',
    element: <HomeRedirect />
  }
]

export default routes
