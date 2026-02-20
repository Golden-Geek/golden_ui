<script lang="ts">
    import type { UiNodeDto } from "$lib/golden_ui/types";

    let { node } = $props<{
        node: UiNodeDto;
    }>();

    let enabled = $derived(node.enabled);
</script>

<span
    class="enable-button"
    role="switch"
    aria-checked={node.enabled}
    class:enabled
    tabindex="0"
    onclick={() => (enabled = !enabled)}
    onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
            enabled = !enabled;
        }
    }}
></span>

<style>
    .enable-button {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 2rem;
        display: inline-block;
        background-color: rgba(50, 50, 50, 0.5);
        cursor: pointer;
        vertical-align: text-top;
        transition:
            background-color 0.2s ease,
            box-shadow 0.2s ease;
    }

    .enable-button.enabled {
        background-color: var(--gc-color-node-enabled);
        box-shadow: 0 0 0.3rem var(--gc-color-node-enabled);
    }
</style>
