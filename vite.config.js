import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Membuka akses jaringan lokal (Wi-Fi) untuk HP
    port: 5173,
    allowedHosts: true // Mengizinkan akses dari tunnel eksternal (HP via internet)
  }
})
