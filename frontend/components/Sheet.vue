<script setup lang="ts">
import { ref,watch,nextTick,onBeforeUnmount,useId } from 'vue';
import Icon from './Icon.vue';
const props=defineProps<{open:boolean;title:string;busy?:boolean;wide?:boolean}>();
const emit=defineEmits<{close:[]}>();const element=ref<HTMLDialogElement>();
const headingId=useId();
watch(()=>props.open,async value=>{await nextTick();if(value&&!element.value?.open)element.value?.showModal();else if(!value&&element.value?.open)element.value.close();},{immediate:true});
function close(){if(!props.busy)emit('close');}
onBeforeUnmount(()=>element.value?.close());
</script>
<template><dialog ref="element" :class="['sheet',{wide}]" :aria-labelledby="headingId" @cancel.prevent="close" @click="event=>{if(event.target===element)close()}"><div class="sheet-inner"><header class="sheet-heading"><h2 :id="headingId">{{title}}</h2><button class="icon-button" type="button" aria-label="关闭窗口" :disabled="busy" @click="close"><Icon name="close"/></button></header><slot v-if="open"/></div></dialog></template>
