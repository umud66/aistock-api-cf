<script setup lang="ts">
withDefaults(defineProps<{name:string;size?:number}>(),{size:20});
const paths:Record<string,string>={
    overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    stocks:'M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M11 17v4',
    rules:'M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 7h6',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    settings:'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    refresh:'M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11-2l3.5 3M4 16l3.5 3a7 7 0 0 0 11-2',
    close:'M6 6l12 12M18 6 6 18',arrow:'M5 12h14M13 6l6 6-6 6',
    edit:'M12 20h9M16 3l5 5L9 20l-6 1 1-6z',copy:'M9 9h12v12H9zM5 15H3V3h12v2',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    play:'M8 5l11 7-11 7z',pause:'M8 5v14M16 5v14',logout:'M9 5H4v14h5M13 8l4 4-4 4M8 12h13',
    sun:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    moon:'M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13',
    check:'M5 12l4 4L19 6',alert:'M12 8v5M12 16h.01M10.3 3.8 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0',
    upload:'M12 16V3M7 8l5-5 5 5M4 16v5h16v-5',menu:'M4 6h16M4 12h16M4 18h16',
    shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM9 12l2 2 4-4',
    eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.overview"/></svg></template>
