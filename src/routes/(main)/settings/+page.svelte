<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  goto(resolve('/(main)/settings/general'), { replace: true });
</script>
