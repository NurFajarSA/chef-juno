<template>
  <span class="badge">{{ label }}</span>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchUser } from '../src/api/user';

const props = defineProps<{ id: string }>();
const label = ref('');

async function refresh() {
  const u = await fetchUser(props.id);
  label.value = u ? u.name : '?';
}

onMounted(refresh);
</script>
