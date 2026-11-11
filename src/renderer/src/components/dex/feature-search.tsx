import { useEffect, useRef, useState } from 'react'
import { Modal, ModalBody, ModalContent } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { LuSearch, LuCornerDownLeft } from 'react-icons/lu'
import { navigationGroups, utilityItems } from './sidebar'

const items = [...navigationGroups.flatMap((group) => group.items), ...utilityItems]

export default function FeatureSearch({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const chinese = i18n.language.startsWith('zh')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const results = items.filter((item) =>
    `${t(item.key, { defaultValue: item.fallback })} ${item.english} ${item.path} ${item.keywords}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )
  const selectedIndex = Math.min(selection, Math.max(results.length - 1, 0))
  const visit = (path: string): void => {
    void navigate(path)
    onClose()
  }

  useEffect(() => {
    resultsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, query])

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      hideCloseButton
      classNames={{ base: 'dex-feature-search' }}
    >
      <ModalContent>
        <ModalBody className="p-0 gap-0">
          <div className="dex-feature-search-input">
            <LuSearch aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder={chinese ? '搜索全部功能…' : 'Search all features…'}
              aria-label={chinese ? '搜索全部功能' : 'Search all features'}
              role="combobox"
              aria-expanded="true"
              aria-controls="dex-feature-results"
              aria-autocomplete="list"
              aria-activedescendant={results.length ? `dex-feature-${selectedIndex}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelection(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSelection(
                    Math.max(
                      0,
                      Math.min(
                        results.length - 1,
                        selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)
                      )
                    )
                  )
                }
                if (event.key === 'Enter' && results[selectedIndex]) {
                  event.preventDefault()
                  visit(results[selectedIndex].path)
                }
              }}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={chinese ? '关闭查找' : 'Close search'}
            >
              Esc
            </button>
          </div>
          <div
            ref={resultsRef}
            id="dex-feature-results"
            className="dex-feature-results custom-scrollbar"
            role="listbox"
            aria-label={chinese ? '功能搜索结果' : 'Feature search results'}
          >
            {results.map((item, index) => {
              const Icon = item.icon
              return (
                <button
                  key={item.path}
                  id={`dex-feature-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  tabIndex={-1}
                  onMouseMove={() => setSelection(index)}
                  onClick={() => visit(item.path)}
                >
                  <Icon />
                  <span>
                    {t(item.key, { defaultValue: chinese ? item.fallback : item.english })}
                  </span>
                  <small>{item.english}</small>
                  {index === selectedIndex && <LuCornerDownLeft />}
                </button>
              )
            })}
            {!results.length && (
              <p role="status">{chinese ? '没有找到匹配功能' : 'No matching features'}</p>
            )}
          </div>
          <div className="dex-feature-search-hint">
            {chinese ? '↑ ↓ 选择 · Enter 打开 · Esc 关闭' : '↑ ↓ Select · Enter Open · Esc Close'}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
