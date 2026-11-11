import React from 'react'
import { GenIcon, IconBaseProps } from 'react-icons'

function MihomoIcon(props: IconBaseProps): React.JSX.Element {
  return GenIcon({
    tag: 'svg',
    attr: { viewBox: '0 0 32 32', fill: 'none' },
    child: [
      {
        tag: 'path',
        attr: {
          d: 'M5 25V7a2 2 0 0 1 3.6-1.2L23 24V7h4v18a2 2 0 0 1-3.6 1.2L9 8v17H5Z',
          fill: 'currentColor',
          fillRule: 'evenodd'
        },
        child: []
      },
      { tag: 'path', attr: { d: 'M20 3h9v9h-2V5h-7z', fill: 'currentColor' }, child: [] }
    ]
  })(props)
}

export default MihomoIcon
