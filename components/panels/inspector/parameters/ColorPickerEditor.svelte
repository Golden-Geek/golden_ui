<script lang="ts">
	import { onDestroy } from 'svelte';
	import ColorPicker from '../../../common/ColorPicker.svelte';
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import { createUiEditSession, sendSetParamIntent } from '$lib/golden_ui/store/ui-intents';
	import type { UiNodeDto } from '$lib/golden_ui/types';

	let { node } = $props<{
		node: UiNodeDto;
	}>();

	let session = $derived(appState.session);
	let liveNode = $derived(session?.graph.state.nodesById.get(node.node_id) ?? node);
	let param = $derived(liveNode.data.kind === 'parameter' ? liveNode.data.param : null);
	let readOnly = $derived(Boolean(param?.read_only));
	let enabled = $derived(liveNode.meta.enabled);
	let value = $derived.by((): [number, number, number, number] => {
		if (param?.value.kind !== 'color') {
			return [0, 0, 0, 1];
		}
		const [red, green, blue, alpha] = param.value.value;
		return [red, green, blue, alpha];
	});

	let editSession = createUiEditSession('Edit color', 'param-color');
	let isEditing = $state(false);
	let draftColor = $state<[number, number, number, number]>([0, 0, 0, 1]);

	$effect(() => {
		if (isEditing) {
			return;
		}
		draftColor = value;
	});

	onDestroy(() => {
		void editSession.end();
	});

	const clamp01 = (valueToClamp: number): number => {
		return Math.min(1, Math.max(0, valueToClamp));
	};

	const toColorArray = (nextColor: unknown): [number, number, number, number] => {
		if (Array.isArray(nextColor)) {
			return [
				clamp01(Number(nextColor[0] ?? 0)),
				clamp01(Number(nextColor[1] ?? 0)),
				clamp01(Number(nextColor[2] ?? 0)),
				clamp01(Number(nextColor[3] ?? 1))
			];
		}
		if (nextColor && typeof nextColor === 'object') {
			const candidate = nextColor as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
			return [
				clamp01(Number(candidate.r ?? 0)),
				clamp01(Number(candidate.g ?? 0)),
				clamp01(Number(candidate.b ?? 0)),
				clamp01(Number(candidate.a ?? 1))
			];
		}
		return [0, 0, 0, 1];
	};

	const startEdit = (): void => {
		if (readOnly || !enabled) {
			return;
		}
		isEditing = true;
		void editSession.begin();
	};

	const updateValue = (nextColor: unknown): void => {
		if (!param || param.value.kind !== 'color' || readOnly || !enabled) {
			return;
		}
		const normalized = toColorArray(nextColor);
		draftColor = normalized;
		void sendSetParamIntent(
			liveNode.node_id,
			{ kind: 'color', value: normalized },
			param.event_behaviour
		);
	};

	const endEdit = (): void => {
		if (!isEditing) {
			return;
		}
		isEditing = false;
		void editSession.end();
	};
</script>

<ColorPicker
	previewIsSwitch={enabled && !readOnly}
	color={draftColor}
	onchange={(nextColor: unknown) => {
		updateValue(nextColor);
	}}
	onStartEdit={startEdit}
	onEndEdit={endEdit}></ColorPicker>

<style>
</style>
