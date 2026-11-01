import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{rollupOptions:{output:{manualChunks:{react:['react','react-dom','react-router-dom'],charts:['recharts']}}}},server:{proxy:{'/api':{target:'http://127.0.0.1:3000',changeOrigin:false}}},preview:{proxy:{'/api':{target:'http://127.0.0.1:3000',changeOrigin:false}}}});

