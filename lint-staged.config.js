export default {
  "src/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.config.ts": ["eslint --fix", "prettier --write"],
  "*.{css,json,html,yml,yaml}": ["prettier --write"],
};
