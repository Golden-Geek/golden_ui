<script lang="ts">
	import type {
		PanelProps,
		PanelState,
	} from "../../dockview/panel-types";

	const initialProps: PanelProps = $props();
	const panelApi = initialProps.panelApi;

	let panel = $state<PanelState>({
		panelId: initialProps.panelId,
		panelType: initialProps.panelType,
		title: initialProps.title,
		params: initialProps.params,
	});
	let publishedTitle = $state("");

	const dynamicTitle = $derived(`Unknown ${panel.title}`);

	$effect(() => {
		if (dynamicTitle === publishedTitle) {
			return;
		}

		panelApi.setTitle(dynamicTitle);
		publishedTitle = dynamicTitle;
	});

	export function setPanelState(next: PanelState): void {
		panel = next;
	}
</script>

<section class="panel unknown">
	<h2>Unknown panel renderer</h2>
	<p>component: {panel.panelType}</p>
	<p>id: {panel.panelId}</p>
</section>

<style>
	.panel {
		display: grid;
		align-content: center;
		justify-items: start;
		gap: 0.4rem;
		inline-size: 100%;
		block-size: 100%;
		padding: 1rem;
		box-sizing: border-box;
		color: var(--gc-color-text);
		background: linear-gradient(
				150deg,
				rgba(255, 255, 255, 0.04),
				transparent 65%
			),
			var(--gc-color-panel-alt);
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-size: 0.95rem;
	}

	p {
		font-size: 0.82rem;
		opacity: 0.8;
	}
</style>
