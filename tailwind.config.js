export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#A44730",
        background: "#F7F6F3",
        foreground: "#272723",
        border: "#E4E1DA",
      },
      fontFamily: { sans: ["Inter", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
};
