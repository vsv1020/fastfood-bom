/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      colors: {
        brand: {
          50:  '#f5f7ff',
          100: '#eaeeff',
          200: '#cdd6ff',
          300: '#9babff',
          400: '#6b80f6',
          500: '#4858e6',
          600: '#3a45c8',
          700: '#2f3aa1',
          800: '#262f7a',
          900: '#1d244f',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 6px 24px -8px rgba(15, 23, 42, 0.10)',
      },
    },
  },
  plugins: [],
};
