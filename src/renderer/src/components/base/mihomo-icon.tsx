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
          d: 'M5 5h10c7 0 12 4.5 12 11S22 27 15 27H5V5Zm5 5v12h5c4.4 0 7-2.3 7-6s-2.6-6-7-6h-5Z',
          fill: 'currentColor',
          fillRule: 'evenodd'
        },
        child: []
      },
      { tag: 'path', attr: { d: 'M2 14h12v4H2z', fill: 'currentColor' }, child: [] }
    ]
  })(props)
}

export default MihomoIcon
