import BasePage from '@renderer/components/base/base-page'
import AccountConfig from '@renderer/components/settings/account-config'

export default function Account(): React.JSX.Element {
  return (
    <BasePage title="D.E.X 账号">
      <AccountConfig />
    </BasePage>
  )
}
