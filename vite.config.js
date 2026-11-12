import { defineConfig } from 'vite';

// Port sabitdir ki, Google API açarının HTTP referrer məhdudiyyəti dəqiq uyğun gəlsin.
// İki səhifə: index.html — təqdimat (landing) səhifəsi, app.html — simulyator.
export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: { rollupOptions: { input: { main: 'index.html', app: 'app.html' } } },
});
