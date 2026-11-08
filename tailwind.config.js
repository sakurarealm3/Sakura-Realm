/** Same settings that used to be inline in index.html (Tailwind CDN). */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './*.js'],
  theme: {
    extend: {
      colors: {
        dark: {
          base: 'rgba(var(--bgb), <alpha-value>)',
          surface: 'rgba(var(--bgs), <alpha-value>)',
          card: 'rgba(var(--bgc), <alpha-value>)',
          border: 'rgba(255, 255, 255, 0.1)'
        },
        sakura: {
          50: 'rgba(var(--c50), <alpha-value>)',
          100: 'rgba(var(--c100), <alpha-value>)',
          300: 'rgba(var(--c300), <alpha-value>)',
          400: 'rgba(var(--c400), <alpha-value>)',
          500: 'rgba(var(--c500), <alpha-value>)',
          600: 'rgba(var(--c600), <alpha-value>)',
          900: 'rgba(var(--c900), <alpha-value>)'
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        serif: ['Cinzel', 'serif']
      },
      boxShadow: {
        'sakura-glow': '0 0 15px rgba(var(--c500), 0.25)',
        'sakura-sm': '0 0 6px rgba(var(--c500), 0.15)'
      }
    }
  }
};
