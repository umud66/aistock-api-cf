import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './research.css';

let stored: string|null = null;
try {stored=localStorage.getItem('stockwatch-theme');} catch { /* Theme preferences are optional. */ }
if (stored === 'dark' || (!stored && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
createApp(App).mount('#app');
