export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#020810',
          900: '#040d1a',
          800: '#071224',
          700: '#0a1628',
          600: '#0d1f38',
          500: '#112240',
          400: '#1a3a5c',
          300: '#1e4976',
        },
        sky: {
          400: '#38bdf8',
          500: '#0ea5e9',
          300: '#7dd3fc',
          200: '#bae6fd',
        }
      }
    }
  },
  plugins: []
}
