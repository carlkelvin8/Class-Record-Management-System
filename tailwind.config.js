export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        background: "rgb(var(--color-background) / <alpha-value>)",
        foreground: "rgb(var(--color-foreground) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        slate: {
          50: "#F4F6EF",
          100: "#E9EDE2",
          200: "#DDE4D5",
          300: "#C2CDBA",
          400: "#8D9987",
          500: "#6D7A66",
          600: "#55634F",
          700: "#3F513E",
          800: "#2E402F",
          900: "#213629",
        },
        emerald: { 50: "#EEF4EB", 700: "#3F634B", 800: "#31513D" },
        amber: {
          50: "#FCF8EF",
          200: "#E8DABD",
          800: "#806331",
          900: "#654E2C",
        },
      },
      fontFamily: { sans: ["Inter", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
};
