/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:      "#15202b",
        card:    "#273340",
        item:    "#1e2732",
        green:   "#00ba7c",
        orange:  "#ef7d31",
        pink:    "#f91880",
        accent:  "#FF8A30",
      },
      fontFamily: { sans: ["Inter", "Manrope", "sans-serif"] }
    }
  },
  plugins: []
}
