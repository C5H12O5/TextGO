<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  // default redirect to shortcut registration page
  goto(resolve('/(main)/shortcuts'), { replace: true });
</script>
