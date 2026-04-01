/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark backgrounds (keep existing from theme.css)
        'dark': {
          bg: {
            primary: '#0f1419',
            secondary: '#1a2332',
            tertiary: '#243044',
          },
        },
        // Purple accent system – DEEP PURPLE PALETTE
        'purple': {
          50: '#f9f5ff',
          100: '#f3ebff',
          200: '#e6d9ff',
          300: '#d9c7ff',
          400: '#ccb5ff',
          500: '#9366cc',  // lighter for some elements
          600: '#8055bb',  // hover
          700: '#7a4db0',  // PRIMARY - main accent
          750: '#6a3fa0',  // darker hover
          800: '#5a3190',
          900: '#4a2670',  // very dark
        },
        // Semantic colors
        'semantic': {
          success: '#4db896',
          warning: '#d4a335',
          error: '#d16b6b',
          info: '#7a4db0',
        },
        // Accent shorthand (matches --accent in theme.css)
        'accent': '#7a4db0',
        'accent-hover': '#6a3fa0',
        'accent-light': '#8f60c4',
        // Grays for UI
        'gray': {
          900: '#0f1419',
          800: '#1a2332',
          700: '#243044',
          600: '#2d3a4a',
          500: '#354556',
          400: '#697784',
          300: '#8b9aab',
          200: '#b8c4d0',
          100: '#e8ecf1',
        },
      },
      backgroundColor: {
        'primary': '#0f1419',
        'secondary': '#1a2332',
        'tertiary': '#243044',
      },
      textColor: {
        'primary': '#e8ecf1',
        'secondary': '#b8c4d0',
        'muted': '#8b9aab',
      },
      borderColor: {
        'default': '#2d3a4a',
        'light': '#354556',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.15)',
        'md': '0 4px 6px rgba(0, 0, 0, 0.15)',
        'lg': '0 10px 15px rgba(147, 102, 204, 0.1)',
        'purple': '0 10px 25px rgba(122, 77, 176, 0.15)',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      spacing: {
        // 8px grid
        'px': '1px',
        '0': '0',
        '1': '0.25rem',
        '2': '0.5rem',
        '3': '0.75rem',
        '4': '1rem',
        '6': '1.5rem',
        '8': '2rem',
        '10': '2.5rem',
        '12': '3rem',
        '16': '4rem',
        '20': '5rem',
        '24': '6rem',
        '32': '8rem',
      },
      fontSize: {
        'xs': ['12px', { lineHeight: '16px' }],
        'sm': ['13px', { lineHeight: '18px' }],
        'base': ['14px', { lineHeight: '20px' }],
        'lg': ['16px', { lineHeight: '24px' }],
        'xl': ['18px', { lineHeight: '28px' }],
        '2xl': ['20px', { lineHeight: '28px' }],
        '3xl': ['24px', { lineHeight: '32px' }],
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
      },
    },
  },
  plugins: [],
};
