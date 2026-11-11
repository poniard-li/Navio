import React from 'react'
import { GenIcon, IconBaseProps } from 'react-icons'

function NavioIcon(props: IconBaseProps): React.JSX.Element {
  return GenIcon({
    tag: 'svg',
    attr: { viewBox: '0 0 128 128', fill: 'none' },
    child: [
      {
        tag: 'path',
        attr: {
          d: 'M30 94V38C30 31 38 28 43 33L84 75V34H99V90C99 97 91 100 86 95L45 53V94Z',
          fill: 'currentColor',
          fillRule: 'evenodd'
        },
        child: []
      }
    ]
  })(props)
}

export default NavioIcon
