import { heroui } from '@heroui/react'

const green = {
  50: '#eef7f3',
  100: '#d8ebe4',
  200: '#b5d8cc',
  300: '#8bbfaf',
  400: '#5d9f8c',
  500: '#387f70',
  600: '#2b695c',
  700: '#25554b',
  800: '#21463e',
  900: '#1d3b35'
}

export default heroui({
  themes: {
    light: {
      colors: {
        primary: { ...green, DEFAULT: green[500], foreground: '#ffffff' },
        focus: green[500],
        background: '#f9fbfa'
      }
    },
    dark: {
      colors: {
        primary: {
          50: green[900],
          100: green[800],
          200: green[700],
          300: green[600],
          400: green[500],
          500: green[400],
          600: green[300],
          700: green[200],
          800: green[100],
          900: green[50],
          DEFAULT: '#8bbfaf',
          foreground: '#152b25'
        },
        focus: '#8bbfaf'
      }
    }
  }
})
