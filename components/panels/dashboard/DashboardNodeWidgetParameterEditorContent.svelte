<script lang="ts">
	import { appState } from '$lib/golden_ui/store/workbench.svelte';
	import type { UiNodeDto } from '$lib/golden_ui/types';
	import CheckboxEditor from '$lib/golden_ui/components/panels/inspector/parameters/CheckboxEditor.svelte';
	import ColorPickerEditor from '$lib/golden_ui/components/panels/inspector/parameters/ColorPickerEditor.svelte';
	import { propertiesInspectorClass } from '$lib/golden_ui/components/panels/inspector/inspector.svelte';
	import MultiNumberEditor from '$lib/golden_ui/components/panels/inspector/parameters/MultiNumberEditor.svelte';
	import NumberEditor from '$lib/golden_ui/components/panels/inspector/parameters/NumberEditor.svelte';
	import { getDirectParam } from './dashboard-model';

	type NumberEditorOptions = {
		show_value_field?: boolean;
		max_decimals?: number;
	};

	type VectorEditorOptions = {
		layout?: 'inline' | 'column';
		show_value_fields?: boolean;
		max_decimals?: number;
	};

	type ColorEditorOptions = {
		force_expanded?: boolean;
		show_hex?: boolean;
		show_rgba_fields?: boolean;
	};

	let { targetNode, widgetNode = null } = $props<{
		targetNode: UiNodeDto;
		widgetNode?: UiNodeDto | null;
	}>();

	let session = $derived(appState.session);
	let graph = $derived(session?.graph.state ?? null);
	let liveWidgetNode = $derived(widgetNode ? (graph?.nodesById.get(widgetNode.node_id) ?? widgetNode) : null);
	let paramKind = $derived(targetNode.data.kind === 'parameter' ? targetNode.data.param.value.kind : null);

	const clampMaxDecimals = (value: number | undefined, fallback: number): number | undefined => {
		if (value === undefined || !Number.isFinite(value)) {
			return fallback;
		}
		return Math.max(0, Math.min(8, Math.round(value)));
	};

	const getBoolWidgetParam = (declId: string, fallback: boolean): boolean => {
		const value = liveWidgetNode ? getDirectParam(graph, liveWidgetNode, declId)?.value : null;
		return value?.kind === 'bool' ? value.value : fallback;
	};

	const getIntWidgetParam = (declId: string, fallback: number): number => {
		const value = liveWidgetNode ? getDirectParam(graph, liveWidgetNode, declId)?.value : null;
		if (value?.kind === 'int') {
			return value.value;
		}
		if (value?.kind === 'float') {
			return value.value;
		}
		return fallback;
	};

	const getEnumWidgetParam = (declId: string, fallback: 'inline' | 'column'): 'inline' | 'column' => {
		const value = liveWidgetNode ? getDirectParam(graph, liveWidgetNode, declId)?.value : null;
		const rawValue = value?.kind === 'enum' || value?.kind === 'str' ? value.value : null;
		return rawValue === 'column' ? 'column' : fallback;
	};

	let numberPresentation = $derived.by((): NumberEditorOptions => ({
		show_value_field: getBoolWidgetParam('number_show_value_field', true),
		max_decimals: clampMaxDecimals(getIntWidgetParam('number_max_decimals', 3), 3)
	}));

	let vectorPresentation = $derived.by((): VectorEditorOptions => ({
		layout: getEnumWidgetParam('vector_layout', 'inline'),
		show_value_fields: getBoolWidgetParam('vector_show_value_fields', true),
		max_decimals: clampMaxDecimals(getIntWidgetParam('vector_max_decimals', 2), 2)
	}));

	let colorPresentation = $derived.by((): ColorEditorOptions => ({
		force_expanded: getBoolWidgetParam('color_force_expanded', false),
		show_hex: getBoolWidgetParam('color_show_hex', true),
		show_rgba_fields: getBoolWidgetParam('color_show_rgba_fields', true)
	}));

	let editorEntry = $derived.by(() => {
		if (targetNode.data.kind !== 'parameter') {
			return null;
		}
		return propertiesInspectorClass[targetNode.data.param.value.kind] ?? null;
	});

	let EditorComponent = $derived(editorEntry?.component ?? null);
</script>

<div class="dashboard-node-widget-parameter-editor">
	{#if targetNode.data.kind !== 'parameter'}
		<div class="dashboard-node-widget-mode-empty">Editor mode only applies to parameters.</div>
	{:else if paramKind === 'int' || paramKind === 'float'}
		<div class="dashboard-node-widget-parameter-editor-body widget-layout">
			<NumberEditor node={targetNode} layoutMode="widget" presentation={numberPresentation} />
		</div>
	{:else if paramKind === 'vec2' || paramKind === 'vec3'}
		<div class="dashboard-node-widget-parameter-editor-body widget-layout">
			<MultiNumberEditor node={targetNode} layoutMode="widget" presentation={vectorPresentation} />
		</div>
	{:else if paramKind === 'color'}
		<div class="dashboard-node-widget-parameter-editor-body widget-layout color-layout">
			<ColorPickerEditor node={targetNode} layoutMode="widget" presentation={colorPresentation} />
		</div>
	{:else if paramKind === 'bool'}
		<div class="dashboard-node-widget-parameter-editor-body widget-layout checkbox-layout">
			<CheckboxEditor node={targetNode} layoutMode="widget" />
		</div>
	{:else if EditorComponent}
		<div class="dashboard-node-widget-parameter-editor-body">
			<EditorComponent node={targetNode} />
		</div>
	{:else}
		<div class="dashboard-node-widget-mode-empty">No editor is registered for this parameter type.</div>
	{/if}
</div>

<style>
	.dashboard-node-widget-parameter-editor {
		display: flex;
		flex: 1 1 auto;
		inline-size: 100%;
		block-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
	}

	.dashboard-node-widget-parameter-editor-body {
		display: flex;
		flex: 1 1 auto;
		align-items: stretch;
		justify-content: stretch;
		inline-size: 100%;
		max-inline-size: 100%;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-node-widget-parameter-editor-body.widget-layout {
		block-size: 100%;
		overflow: hidden;
	}

	.dashboard-node-widget-parameter-editor-body.color-layout,
	.dashboard-node-widget-parameter-editor-body.checkbox-layout {
		overflow: auto;
	}

	.dashboard-node-widget-parameter-editor :global(.number-property-container),
	.dashboard-node-widget-parameter-editor :global(.slider-wrapper),
	.dashboard-node-widget-parameter-editor :global(.css-value-editor),
	.dashboard-node-widget-parameter-editor :global(.multi-number-editor),
	.dashboard-node-widget-parameter-editor :global(.color-picker-editor),
	.dashboard-node-widget-parameter-editor :global(.editor-checkbox-shell),
	.dashboard-node-widget-parameter-editor :global(.reference-property-container),
	.dashboard-node-widget-parameter-editor :global(.text-input-editor),
	.dashboard-node-widget-parameter-editor :global(.dropdown-container) {
		inline-size: 100%;
		block-size: 100%;
		max-inline-size: none;
		min-inline-size: 0;
		min-block-size: 0;
	}

	.dashboard-node-widget-parameter-editor :global(.slider-wrapper) {
		flex: 1 1 auto;
	}

	.dashboard-node-widget-parameter-editor :global(.number-property-container.widget-layout),
	.dashboard-node-widget-parameter-editor :global(.multi-number-editor.widget-layout) {
		height: 100%;
	}

	.dashboard-node-widget-parameter-editor :global(textarea),
	.dashboard-node-widget-parameter-editor :global(input[type='text']),
	.dashboard-node-widget-parameter-editor :global(input[type='number']),
	.dashboard-node-widget-parameter-editor :global(select) {
		max-inline-size: none;
	}

	.dashboard-node-widget-mode-empty {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		padding: 0.75rem;
		text-align: center;
		font-size: 0.72rem;
		opacity: 0.72;
	}
</style>